import type {
  ContractArtifact,
  ExecutionSession,
  McpNode,
  McpNodeStatus,
  OrchestratedTask,
  OrchestratedTaskStatus,
  ReviewApproval,
  ReviewArtifact,
  SessionPhase,
  TaskGraph,
  TelemetryEvent,
  WorkspaceDescriptor,
} from '../types.js'
import { SessionRuntime } from './runtime/session-runtime.js'
import { Scheduler } from './scheduler/scheduler.js'
import { PolicyEngine } from './policy/policy-engine.js'
import { WorkerRunner } from './worker/worker-runner.js'
import { QualityGate } from './quality/quality-gate.js'
import { GitMergeService } from './git/git-merge-service.js'
import { FailureRecovery } from './recovery/failure-recovery.js'
import { createAuditRecord } from './telemetry/audit-trail.js'

export function parseReviewArtifacts(
  sessionArtifacts: Record<string, string>,
  sessionTasks: Array<{ id: string; roleType: string; assignedMcpId?: string; status: string }>
): ReviewArtifact[] {
  const reviewerTask = sessionTasks.find(task => task.roleType === 'reviewer')
  if (!reviewerTask || reviewerTask.status !== 'completed' || !reviewerTask.assignedMcpId) return []

  const rawOutput = sessionArtifacts[`output:${reviewerTask.id}`] || ''
  const lines = rawOutput.split('\n').map(line => line.trim()).filter(Boolean)
  const artifacts: ReviewArtifact[] = []

  for (const line of lines) {
    const match = /^REVIEW\s+(APPROVED|CHANGES_REQUESTED)\s+(task-\d+)\s*-\s*(.+)$/i.exec(line)
    if (!match) continue
    artifacts.push({
      reviewerMcpId: reviewerTask.assignedMcpId,
      reviewerTaskId: reviewerTask.id,
      targetTaskId: match[2],
      summary: match[3],
      approved: match[1].toUpperCase() === 'APPROVED',
      timestamp: new Date().toISOString(),
    })
  }

  return artifacts
}

export function approvalsFromArtifacts(artifacts: ReviewArtifact[]): ReviewApproval[] {
  return artifacts.map(item => ({
    reviewerMcpId: item.reviewerMcpId,
    taskId: item.targetTaskId,
    approved: item.approved,
    comment: item.summary,
    timestamp: item.timestamp,
  }))
}

export function withTaskRunning(session: ExecutionSession, task: OrchestratedTask): ExecutionSession {
  const updatedTaskGraph: TaskGraph = {
    tasks: session.taskGraph.tasks.map(item =>
      item.id === task.id
        ? { ...item, status: 'running' }
        : item
    ),
  }

  const updatedMcps: McpNode[] = session.mcps.map(item =>
    item.id === task.assignedMcpId
      ? { ...item, status: 'running' as McpNodeStatus }
      : item
  )

  return {
    ...session,
    taskGraph: updatedTaskGraph,
    mcps: updatedMcps,
    resumeCursor: {
      phase: session.phase,
      taskIds: updatedTaskGraph.tasks.filter(item => item.status !== 'completed').map(item => item.id),
    },
  }
}

export function withTaskStatus(session: ExecutionSession, taskId: string, status: OrchestratedTaskStatus, output: string): ExecutionSession {
  const updatedTaskGraph: TaskGraph = {
    tasks: session.taskGraph.tasks.map(item =>
      item.id === taskId
        ? {
            ...item,
            status,
            governanceStatus: item.reviewRequired
              ? status === 'completed'
                ? 'waiting_approval'
                : item.governanceStatus
              : item.governanceStatus,
            artifacts: output ? [...item.artifacts, `output:${taskId}`] : item.artifacts,
          }
        : item
    ),
  }

  const targetTask = updatedTaskGraph.tasks.find(task => task.id === taskId)
  const updatedMcps: McpNode[] = session.mcps.map(item => {
    if (item.id !== targetTask?.assignedMcpId) return item
    return {
      ...item,
      status: (status === 'failed' ? 'failed' : 'idle') as McpNodeStatus,
    }
  })

  const nextPhase: SessionPhase = status === 'failed' ? 'failed' : session.phase

  return {
    ...session,
    phase: nextPhase,
    taskGraph: updatedTaskGraph,
    mcps: updatedMcps,
    artifacts: {
      ...session.artifacts,
      ...(output ? { [`output:${taskId}`]: output } : {}),
    },
    resumeCursor: {
      phase: nextPhase,
      taskIds: updatedTaskGraph.tasks.filter(item => item.status !== 'completed').map(item => item.id),
    },
  }
}

export function getRunnableTasks(session: ExecutionSession): OrchestratedTask[] {
  return session.taskGraph.tasks.filter(task => task.status === 'ready' && task.assignedMcpId)
}

export function missingWorkerTelemetry(sessionId: string, task: OrchestratedTask, mcpId?: string, activeModel?: string): TelemetryEvent {
  return {
    id: `evt-${Date.now()}-${task.id}`,
    timestamp: new Date().toISOString(),
    sessionId,
    mcpId,
    taskId: task.id,
    type: 'worker.failed',
    message: `workspace or node missing for ${task.id}`,
    activeModel,
  }
}

function taskAudit(sessionId: string, task: OrchestratedTask, action: string, status: 'passed' | 'failed', message: string) {
  return createAuditRecord({
    sessionId,
    scope: 'session',
    action,
    status,
    taskId: task.id,
    mcpId: task.assignedMcpId,
    actor: task.assignedMcpId,
    message,
    metadata: {
      title: task.title,
      roleType: task.roleType,
    },
  })
}

export function formatFailedBranches(mergeResult: { failedBranches?: Array<{ branch: string; error?: string }> }): string {
  return mergeResult.failedBranches?.map(item => `${item.branch}${item.error ? `(${item.error})` : ''}`).join(', ') || 'none'
}

export function buildMergeSummaryLines(mergeResult: {
  success: boolean
  mergeOrder?: string[]
  mergedBranches?: string[]
  failedBranches?: Array<{ branch: string; error?: string }>
  conflicts?: string[]
  error?: string
} | null): string[] {
  return [
    `merge: ${mergeResult ? (mergeResult.success ? 'passed' : 'failed') : 'none'}`,
    `merge order: ${mergeResult?.mergeOrder?.join(', ') || 'none'}`,
    `merged branches: ${mergeResult?.mergedBranches?.join(', ') || 'none'}`,
    `failed branches: ${mergeResult ? formatFailedBranches(mergeResult) : 'none'}`,
    `merge conflicts: ${mergeResult?.conflicts?.join(', ') || 'none'}`,
    `merge error: ${mergeResult?.error || 'none'}`,
  ]
}

export async function executeSessionPipeline(options: {
  projectRoot: string
  session: ExecutionSession
  workspaces: Record<string, WorkspaceDescriptor>
  contracts: ContractArtifact[]
  context: string
  taskAction: string
  mergeAction: string
  mergeSuccessMessage: string
  mergeFailureFallback: string
  includeGovernanceAuditRecord?: boolean
  includeMergeMetadata?: boolean
}): Promise<ExecutionSession> {
  const runtime = new SessionRuntime(options.projectRoot)
  const scheduler = new Scheduler()
  const policy = new PolicyEngine()
  const worker = new WorkerRunner()
  let running = options.session

  while (true) {
    running = scheduler.reconcile(running)
    runtime.save(running)

    const runnableTasks = getRunnableTasks(running)
    if (runnableTasks.length === 0) break

    const dispatchBatch = runnableTasks.filter(task => {
      const node = running.mcps.find(item => item.id === task.assignedMcpId)
      if (!node) return false
      return node.status !== 'running'
        && node.status !== 'failed'
        && policy.canExecuteTask(node, task, running.controllerMcpId)
    })

    if (dispatchBatch.length === 0) break

    for (const task of dispatchBatch) {
      running = withTaskRunning(running, task)
    }
    runtime.save(running)

    const batchSnapshot = running
    const results = await Promise.all(
      dispatchBatch.map(async task => {
        const node = batchSnapshot.mcps.find(item => item.id === task.assignedMcpId)
        const workspace = task.assignedMcpId ? options.workspaces[task.assignedMcpId] : undefined
        if (!node || !workspace) {
          return {
            task,
            result: {
              success: false,
              output: '',
              telemetry: missingWorkerTelemetry(batchSnapshot.sessionId, task, task.assignedMcpId, node?.activeModel),
            },
          }
        }

        const result = await worker.run(batchSnapshot.sessionId, node, task, workspace, options.contracts, options.context)
        return { task, result }
      })
    )

    for (const { task, result } of results) {
      const nextStatus: OrchestratedTaskStatus = result.success ? 'completed' : 'failed'
      running = withTaskStatus(running, task.id, nextStatus, result.output)
      running = runtime.appendTelemetry(running, result.telemetry)
      running = runtime.appendAudit(running, [
        taskAudit(running.sessionId, task, options.taskAction, result.success ? 'passed' : 'failed', result.telemetry.message),
      ])
      running = scheduler.reconcile(running)
      runtime.save(running)
    }
  }

  const reviewArtifacts = parseReviewArtifacts(running.artifacts, running.taskGraph.tasks)
  const reviewApprovals = approvalsFromArtifacts(reviewArtifacts)
  running = scheduler.reconcile({
    ...running,
    reviewArtifacts,
    reviewApprovals,
  })

  const governanceAudit = policy.buildGovernanceAudit(running, running.reviewAssignments || [], reviewApprovals)
  const qualityGate = await new QualityGate().runAll(options.projectRoot, running, reviewApprovals)
  const mergeResult = await new GitMergeService(options.projectRoot).merge(running, options.workspaces)
  const recovery = !mergeResult.success
    ? await new FailureRecovery(options.projectRoot).recover(running, mergeResult.error || 'merge failed', options.workspaces)
    : []

  const failed = running.taskGraph.tasks.filter(task => task.status === 'failed').length
  const finalPhase: SessionPhase = failed > 0 || !qualityGate.passed || !mergeResult.success
    ? 'failed'
    : 'completed'

  const auditRecords = [
    ...(options.includeGovernanceAuditRecord ? [createAuditRecord({
      sessionId: running.sessionId,
      scope: 'governance',
      action: 'governance-audit',
      status: 'passed',
      actor: running.controllerMcpId,
      message: 'governance audit recorded',
      metadata: {
        assignments: String(running.reviewAssignments?.length || 0),
        approvals: String(reviewApprovals.length),
      },
    })] : []),
    createAuditRecord({
      sessionId: running.sessionId,
      scope: 'merge',
      action: options.mergeAction,
      status: mergeResult.success ? 'passed' : 'failed',
      actor: running.controllerMcpId,
      message: mergeResult.success ? options.mergeSuccessMessage : (mergeResult.error || options.mergeFailureFallback),
      metadata: options.includeMergeMetadata ? {
        mergedBranches: String(mergeResult.mergedBranches?.length || 0),
        failedBranches: String(mergeResult.failedBranches?.length || 0),
      } : undefined,
    }),
    ...recovery.map(item => createAuditRecord({
      sessionId: running.sessionId,
      scope: item.action?.startsWith('rollback') ? 'rollback' : 'recovery',
      action: item.action || 'recovery-step',
      status: item.status,
      actor: item.mcpId,
      mcpId: item.mcpId,
      taskId: item.taskId,
      message: item.message,
      metadata: item.suggestion ? { suggestion: item.suggestion } : undefined,
    })),
  ]

  const finalSession: ExecutionSession = runtime.appendAudit({
    ...running,
    phase: finalPhase,
    qualityGate,
    governanceAudit,
    reviewArtifacts,
    reviewApprovals,
    recovery,
    artifacts: {
      ...running.artifacts,
      mergeResult: JSON.stringify(mergeResult, null, 2),
    },
    resumeCursor: {
      phase: finalPhase,
      taskIds: running.taskGraph.tasks.filter(task => task.status !== 'completed').map(task => task.id),
    },
  }, auditRecords)
  runtime.save(finalSession)
  return finalSession
}
