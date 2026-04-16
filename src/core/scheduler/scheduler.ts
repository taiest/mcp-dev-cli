import type { ExecutionSession, McpNodeStatus, OrchestratedTask } from '../../types.js'
import { AssignmentEngine } from './assignment-engine.js'
import { ReviewCoordinator } from './review-coordinator.js'
import { BlockerCoordinator } from './blocker-coordinator.js'
import { ContractCoordinator } from './contract-coordinator.js'

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
      taskGraph: { tasks: assignedTasks },
      mcps: session.mcps.map(mcp => ({ ...mcp, status: assignedTasks.some(task => task.assignedMcpId === mcp.id) ? 'assigned' : mcp.status })),
      resumeCursor: { phase: 'running', taskIds: this.blockers.findBlockedTasks({ ...session, taskGraph: { tasks: assignedTasks } }) },
    }

    const withContracts = this.contracts.attach(withAssignments, session.contracts)
    const reviewed = this.review.assignReviewers(withContracts)
    return this.reconcile(reviewed)
  }

  requeueRecoverable(session: ExecutionSession): ExecutionSession {
    const recoveredTasks: OrchestratedTask[] = session.taskGraph.tasks.map(task => {
      if (task.status === 'failed') {
        return {
          ...task,
          status: 'pending',
          governanceStatus: task.reviewRequired ? 'review_required' : 'pending',
          approvedBy: [],
          rejectedBy: [],
          artifacts: task.artifacts.filter(item => !item.startsWith('output:')),
        }
      }

      if (task.status === 'blocked' && !this.isContractBlocked(task)) {
        return {
          ...task,
          status: 'pending',
          governanceStatus: task.reviewRequired ? 'review_required' : 'pending',
        }
      }

      return task
    })

    const recoveredSession: ExecutionSession = {
      ...session,
      phase: 'running',
      mcps: session.mcps.map(mcp => ({
        ...mcp,
        status: this.recoverNodeStatus(mcp.status),
      })),
      taskGraph: { tasks: recoveredTasks },
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

    const tasks = session.taskGraph.tasks.map(task => this.reconcileTask(task, completed))
    const nextSession: ExecutionSession = {
      ...session,
      phase: session.phase,
      taskGraph: { tasks },
      resumeCursor: {
        phase: session.phase,
        taskIds: this.blockers.findBlockedTasks({ ...session, taskGraph: { tasks } }),
      },
    }

    return this.review.assignReviewers(nextSession)
  }

  private reconcileTask(task: OrchestratedTask, completed: Set<string>): OrchestratedTask {
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'running' || this.isContractBlocked(task)) {
      return task
    }

    const ready = task.dependencies.every(dep => completed.has(dep))
    return {
      ...task,
      status: ready ? 'ready' : 'blocked',
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
