import type { ExecutionSession, McpNodeStatus, OrchestratedTask, TaskReassignmentRecord } from '../../types.js'
import { AssignmentEngine } from './assignment-engine.js'
import { ReviewCoordinator } from './review-coordinator.js'
import { BlockerCoordinator } from './blocker-coordinator.js'
import { ContractCoordinator } from './contract-coordinator.js'

function hasRejectionForTask(session: ExecutionSession, taskId: string): boolean {
  return Boolean(session.reviewApprovals?.some(item => item.taskId === taskId && !item.approved))
}

function buildInvalidatedTaskIds(session: ExecutionSession): Set<string> {
  const invalidated = new Set(
    (session.reviewApprovals || [])
      .filter(item => !item.approved)
      .map(item => item.taskId)
  )

  let changed = true
  while (changed) {
    changed = false
    for (const task of session.taskGraph.tasks) {
      if (invalidated.has(task.id)) continue
      if (task.dependencies.some(dep => invalidated.has(dep))) {
        invalidated.add(task.id)
        changed = true
      }
    }
  }

  return invalidated
}

function now(): string {
  return new Date().toISOString()
}

export class Scheduler {
  private assignment = new AssignmentEngine()
  private review = new ReviewCoordinator()
  private blockers = new BlockerCoordinator()
  private contracts = new ContractCoordinator()

  schedule(session: ExecutionSession): ExecutionSession {
    const assignedTasks = this.assignment.assign(session.taskGraph.tasks, session.mcps)
    const withAssignments: ExecutionSession = {
      ...session,
      phase: session.preflight?.passed === false ? 'failed' : 'running',
      taskGraph: { ...session.taskGraph, tasks: assignedTasks },
      mcps: session.mcps.map(mcp => ({ ...mcp, status: assignedTasks.some(task => task.assignedMcpId === mcp.id) ? 'assigned' : mcp.status })),
      resumeCursor: { phase: 'running', taskIds: this.blockers.findBlockedTasks({ ...session, taskGraph: { ...session.taskGraph, tasks: assignedTasks } }) },
    }

    const withContracts = this.contracts.attach(withAssignments, session.contracts)
    const reviewed = this.review.assignReviewers(withContracts)
    return this.reconcile(reviewed)
  }

  requeueRecoverable(session: ExecutionSession): ExecutionSession {
    const invalidatedTaskIds = buildInvalidatedTaskIds(session)
    const reassignmentHistory: TaskReassignmentRecord[] = [...(session.reassignmentHistory || [])]
    const recoveredTasks: OrchestratedTask[] = session.taskGraph.tasks.map(task => {
      const failedOrInvalidated = task.status === 'failed' || invalidatedTaskIds.has(task.id)
      const shouldResetBlocked = task.status === 'blocked' && !this.isContractBlocked(task)
      const shouldResetReviewer = task.status === 'completed' && task.roleType === 'reviewer' && (session.reviewApprovals?.length || 0) === 0

      let nextTask: OrchestratedTask = task

      if (failedOrInvalidated) {
        nextTask = {
          ...task,
          status: 'pending',
          governanceStatus: task.reviewRequired ? 'review_required' : 'pending',
          approvedBy: [],
          rejectedBy: [],
          artifacts: task.artifacts.filter(item => !item.startsWith('output:')),
        }
      } else if (shouldResetBlocked) {
        nextTask = {
          ...task,
          status: 'pending',
          governanceStatus: task.reviewRequired ? 'review_required' : 'pending',
        }
      } else if (shouldResetReviewer) {
        nextTask = {
          ...task,
          status: 'pending',
          artifacts: task.artifacts.filter(item => !item.startsWith('output:')),
        }
      }

      if (!failedOrInvalidated || !task.assignedMcpId) return nextTask

      const replacement = this.assignment.pickReplacement(task, session.mcps, task.assignedMcpId)
      if (!replacement || replacement.id === task.assignedMcpId) {
        return {
          ...nextTask,
          lastFailureReason: task.lastFailureReason || `resume requested after failure on ${task.assignedMcpId}`,
        }
      }

      reassignmentHistory.push({
        taskId: task.id,
        fromMcpId: task.assignedMcpId,
        toMcpId: replacement.id,
        reason: task.lastFailureReason || `resume requested after failure on ${task.assignedMcpId}`,
        timestamp: now(),
      })

      return {
        ...nextTask,
        assignedMcpId: replacement.id,
        reassignmentCount: (task.reassignmentCount || 0) + 1,
        lastFailureReason: task.lastFailureReason || `resume requested after failure on ${task.assignedMcpId}`,
        previousAssignments: Array.from(new Set([...(task.previousAssignments || []), task.assignedMcpId])),
      }
    })

    const recoveredSession: ExecutionSession = {
      ...session,
      phase: 'running',
      reviewArtifacts: invalidatedTaskIds.size > 0 ? [] : session.reviewArtifacts,
      reviewApprovals: invalidatedTaskIds.size > 0 ? [] : session.reviewApprovals,
      reassignmentHistory,
      mcps: session.mcps.map(mcp => ({
        ...mcp,
        status: this.recoverNodeStatus(mcp.status),
      })),
      taskGraph: { ...session.taskGraph, tasks: recoveredTasks },
      resumeCursor: {
        phase: 'running',
        taskIds: recoveredTasks.filter(task => task.status !== 'completed').map(task => task.id),
      },
    }

    return this.reconcile(recoveredSession)
  }

  reconcile(session: ExecutionSession): ExecutionSession {
    const completed = new Set(
      session.taskGraph.tasks
        .filter(task => task.status === 'completed')
        .map(task => task.id)
    )

    const tasks = session.taskGraph.tasks.map(task => this.reconcileTask(task, completed, session))
    const nextSession: ExecutionSession = {
      ...session,
      phase: session.phase,
      taskGraph: { ...session.taskGraph, tasks },
      resumeCursor: {
        phase: session.phase,
        taskIds: this.blockers.findBlockedTasks({ ...session, taskGraph: { ...session.taskGraph, tasks } }),
      },
    }

    return this.review.assignReviewers(nextSession)
  }

  private reconcileTask(task: OrchestratedTask, completed: Set<string>, session: ExecutionSession): OrchestratedTask {
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'running' || this.isContractBlocked(task)) {
      return task
    }

    const dependenciesReady = task.dependencies.every(dep => completed.has(dep))

    if (task.roleType === 'reviewer') {
      return {
        ...task,
        status: dependenciesReady ? 'ready' : 'blocked',
        governanceStatus: 'pending',
      }
    }

    if (task.reviewRequired && hasRejectionForTask(session, task.id)) {
      return {
        ...task,
        status: dependenciesReady ? 'ready' : 'blocked',
        governanceStatus: 'review_required',
      }
    }

    return {
      ...task,
      status: dependenciesReady ? 'ready' : 'blocked',
      governanceStatus: task.reviewRequired
        ? task.reviewAssignedTo.length > 0
          ? 'review_assigned'
          : 'review_required'
        : task.governanceStatus || 'pending',
    }
  }

  private recoverNodeStatus(status: McpNodeStatus): McpNodeStatus {
    if (status === 'failed' || status === 'running' || status === 'blocked' || status === 'completed') {
      return 'idle'
    }
    return status
  }

  private isContractBlocked(task: OrchestratedTask): boolean {
    return task.artifacts.some(item => item.startsWith('blocked-by-contract:'))
  }
}
