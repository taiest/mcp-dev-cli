import type {
  ContractArtifact,
  ExecutionSession,
  McpNode,
  McpNodeStatus,
  OrchestratedTask,
  OrchestratedTaskStatus,
  ParallelProgressEvent,
  ReviewApproval,
  ReviewArtifact,
  SessionPhase,
  TaskGraph,
  TaskReassignmentRecord,
  TelemetryEvent,
  WorkspaceDescriptor,
} from '../types.js'
import { SessionRuntime } from './runtime/session-runtime.js'
import { SessionStore } from './runtime/session-store.js'
import { Scheduler } from './scheduler/scheduler.js'
import { AssignmentEngine } from './scheduler/assignment-engine.js'
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
    const structured = /^REVIEW\s+(APPROVED|CHANGES_REQUESTED)\s+(task-\d+)\s*-\s*(.+)$/i.exec(line)
    if (structured) {
      artifacts.push({
        reviewerMcpId: reviewerTask.assignedMcpId,
        reviewerTaskId: reviewerTask.id,
        targetTaskId: structured[2],
        summary: structured[3],
        approved: structured[1].toUpperCase() === 'APPROVED',
        timestamp: new Date().toISOString(),
      })
      continue
    }

    const fallback = /(?:current review decision|review decision|当前 review decision)\s*[:：]\s*(?:\*\*)?(task-\d+)(?:\*\*)?\s*[:：-]\s*(?:\*\*)?(approve|approved|request changes|changes requested|rejected)(?:\*\*)?/i.exec(line)
      || /(?:\*\*)?(task-\d+)(?:\*\*)?\s*[:：-]\s*(?:\*\*)?(approve|approved|request changes|changes requested|rejected)(?:\*\*)?/i.exec(line)
    if (!fallback) continue

    const decision = fallback[2].toLowerCase()
    artifacts.push({
      reviewerMcpId: reviewerTask.assignedMcpId,
      reviewerTaskId: reviewerTask.id,
      targetTaskId: fallback[1],
      summary: line,
      approved: decision === 'approve' || decision === 'approved',
      timestamp: new Date().toISOString(),
    })
  }

  if (artifacts.length > 0) return artifacts

  const targetIds = Array.from(new Set((rawOutput.match(/task-\d+/gi) || []).map(item => item.toLowerCase())))
  const inferredRejected = /(未通过|不通过|需修改|request changes|changes requested|rejected|不能批准)/i.test(rawOutput)
  const inferredApproved = /(已通过|通过审查|批准|approved)/i.test(rawOutput) && !inferredRejected

  if (targetIds.length === 0 || (!inferredRejected && !inferredApproved)) return []

  return targetIds.map(taskId => ({
    reviewerMcpId: reviewerTask.assignedMcpId!,
    reviewerTaskId: reviewerTask.id,
    targetTaskId: taskId,
    summary: rawOutput.split('\n').slice(0, 8).join(' ').trim(),
    approved: inferredApproved,
    timestamp: new Date().toISOString(),
  }))
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

export function withTaskStatus(session: ExecutionSession, taskId: string, status: OrchestratedTaskStatus, output: string, failureReason?: string): ExecutionSession {
  const updatedTaskGraph: TaskGraph = {
    ...session.taskGraph,
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
            lastFailureReason: status === 'failed' ? failureReason || 'task execution failed' : item.lastFailureReason,
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

function progressEvent(kind: ParallelProgressEvent['kind'], message: string, partial: Omit<ParallelProgressEvent, 'kind' | 'message' | 'timestamp'> = {}): ParallelProgressEvent {
  return {
    kind,
    message,
    timestamp: new Date().toISOString(),
    ...partial,
  }
}

function progressTelemetry(session: ExecutionSession, event: ParallelProgressEvent): TelemetryEvent {
  return {
    id: `evt-${Date.now()}-${event.kind}-${event.taskId || 'session'}`,
    timestamp: event.timestamp,
    sessionId: session.sessionId,
    mcpId: event.mcpId,
    taskId: event.taskId,
    type: event.kind === 'worker' ? 'worker.output' : event.kind === 'task' ? 'task.progress' : `${event.kind}.progress`,
    message: event.message,
    durationMs: event.durationMs,
    activeModel: event.activeModel,
    metadata: {
      ...(event.phase ? { phase: String(event.phase) } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(event.snippet ? { snippet: event.snippet } : {}),
      ...(event.batchId ? { batchId: event.batchId } : {}),
    },
  }
}

function formatFailedBranches(mergeResult: { failedBranches?: Array<{ branch: string; error?: string }> }): string {
  return mergeResult.failedBranches?.map(item => `${item.branch}${item.error ? `(${item.error})` : ''}`).join(', ') || 'none'
}

function buildReadyRoleSummary(session: ExecutionSession): string {
  const readyTasks = session.taskGraph.tasks.filter(task => task.status === 'ready')
  if (readyTasks.length === 0) return 'ready=0 blocked=0'

  const byRole = readyTasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.roleType] = (acc[task.roleType] || 0) + 1
    return acc
  }, {})
  const roleSummary = Object.entries(byRole)
    .map(([role, count]) => `${role}:${count}`)
    .join(', ')
  return `ready=${readyTasks.length} blocked=${session.taskGraph.tasks.filter(task => task.status === 'blocked').length} roles=${roleSummary}`
}

function buildRunningMcpSummary(session: ExecutionSession): string {
  const running = session.mcps.filter(mcp => mcp.status === 'running')
  if (running.length === 0) return 'running-mcps=0'
  return `running-mcps=${running.length} ${running.map(mcp => mcp.id).join(', ')}`
}

export function buildMergeSummaryLines(mergeResult: {
  success: boolean
  mergeOrder?: string[]
  mergedBranches?: string[]
  failedBranches?: Array<{ branch: string; error?: string }>
  conflicts?: string[]
  error?: string
} | null, label = 'merge'): string[] {
  return [
    `${label}: ${mergeResult ? (mergeResult.success ? 'passed' : 'failed') : 'none'}`,
    `${label} order: ${mergeResult?.mergeOrder?.join(', ') || 'none'}`,
    `merged branches: ${mergeResult?.mergedBranches?.join(', ') || 'none'}`,
    `failed branches: ${mergeResult ? formatFailedBranches(mergeResult) : 'none'}`,
    `${label} conflicts: ${mergeResult?.conflicts?.join(', ') || 'none'}`,
    `${label} error: ${mergeResult?.error || 'none'}`,
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
  onProgress?: (event: ParallelProgressEvent, session: ExecutionSession) => void
}): Promise<ExecutionSession> {
  const runtime = new SessionRuntime(options.projectRoot)
  const scheduler = new Scheduler()
  const policy = new PolicyEngine()
  const worker = new WorkerRunner()
  let running = options.session

  while (true) {
    running = scheduler.reconcile(running)
    runtime.save(running)
    options.onProgress?.(progressEvent('session', `phase=${running.phase} runnable scan`, {
      phase: running.phase,
      status: running.phase,
      snippet: buildReadyRoleSummary(running),
    }), running)

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

    const batchId = `batch-${Date.now()}`
    options.onProgress?.(progressEvent('batch', `dispatching ${dispatchBatch.length} tasks`, {
      phase: running.phase,
      batchId,
      status: 'dispatching',
      snippet: `${dispatchBatch.map(task => `${task.id}@${task.assignedMcpId || 'none'}`).join(', ')} | ${buildRunningMcpSummary(running)}`,
    }), running)

    for (const task of dispatchBatch) {
      running = withTaskRunning(running, task)
      const taskStarted = progressEvent('task', `${task.id} started on ${task.assignedMcpId || 'none'}`, {
        phase: running.phase,
        taskId: task.id,
        mcpId: task.assignedMcpId,
        status: 'running',
      })
      running = runtime.appendTelemetry(running, {
        ...progressTelemetry(running, taskStarted),
        type: 'task.started',
      })
      options.onProgress?.(taskStarted, running)
    }
    runtime.save(running)

    const batchSnapshot = running
    const results = await Promise.all(
      dispatchBatch.map(async task => {
        const node = batchSnapshot.mcps.find(item => item.id === task.assignedMcpId)
        const workspace = (() => {
          if (task.roleType !== 'reviewer') {
            return task.assignedMcpId ? options.workspaces[task.assignedMcpId] : undefined
          }

          const reviewTarget = batchSnapshot.taskGraph.tasks.find(item =>
            item.reviewRequired
            && item.status === 'completed'
            && task.dependencies.includes(item.id)
            && item.assignedMcpId
          )
          return reviewTarget?.assignedMcpId ? options.workspaces[reviewTarget.assignedMcpId] : (task.assignedMcpId ? options.workspaces[task.assignedMcpId] : undefined)
        })()
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

        const result = await worker.run(batchSnapshot, node, task, workspace, options.contracts, options.context, event => {
          const telemetry = progressTelemetry(batchSnapshot, event)
          running = runtime.appendTelemetry(running, telemetry)
          options.onProgress?.(event, running)
        })
        return { task, result }
      })
    )

    const assignmentEngine = new AssignmentEngine()
    for (const { task, result } of results) {
      let nextStatus: OrchestratedTaskStatus = result.success ? 'completed' : 'failed'

      // Mid-execution reassignment: if task failed and hasn't exceeded retry limit, try to reassign
      if (!result.success && (task.reassignmentCount || 0) < 2) {
        const replacement = assignmentEngine.pickReplacement(task, running.mcps, task.assignedMcpId)
        if (replacement) {
          const record: TaskReassignmentRecord = {
            taskId: task.id,
            fromMcpId: task.assignedMcpId || 'unknown',
            toMcpId: replacement.id,
            reason: result.telemetry.message || 'task failed, auto-reassigned',
            timestamp: new Date().toISOString(),
          }
          running = {
            ...running,
            reassignmentHistory: [...(running.reassignmentHistory || []), record],
            taskGraph: {
              ...running.taskGraph,
              tasks: running.taskGraph.tasks.map(t => t.id === task.id ? {
                ...t,
                status: 'pending' as OrchestratedTaskStatus,
                assignedMcpId: replacement.id,
                reassignmentCount: (t.reassignmentCount || 0) + 1,
                lastFailureReason: result.telemetry.message,
                previousAssignments: [...(t.previousAssignments || []), task.assignedMcpId || 'unknown'],
              } : t),
            },
          }
          running = runtime.appendAudit(running, [createAuditRecord({
            sessionId: running.sessionId,
            scope: 'recovery',
            action: 'mid-execution-reassign',
            status: 'passed',
            actor: running.controllerMcpId,
            mcpId: replacement.id,
            taskId: task.id,
            message: `reassigned ${task.id} from ${task.assignedMcpId} to ${replacement.id}: ${result.telemetry.message || 'failed'}`,
          })])
          options.onProgress?.(progressEvent('recovery', `${task.id} reassigned: ${task.assignedMcpId} → ${replacement.id}`, {
            taskId: task.id,
            mcpId: replacement.id,
            status: 'reassigned',
          }), running)
          runtime.save(running)
          continue // skip marking as failed — task will re-enter runnable queue
        }
      }

      running = withTaskStatus(running, task.id, nextStatus, result.output, result.success ? undefined : result.telemetry.message)
      running = runtime.appendTelemetry(running, result.telemetry)
      running = runtime.appendAudit(running, [
        taskAudit(running.sessionId, task, options.taskAction, result.success ? 'passed' : 'failed', result.telemetry.message),
      ])

      // Save context snapshot for completed/failed tasks
      const now = new Date()
      const store = new SessionStore(options.projectRoot)
      store.saveTaskContext({
        mcpId: task.assignedMcpId || 'unknown',
        taskId: task.id,
        sessionId: running.sessionId,
        roleType: task.roleType,
        title: task.title,
        requirement: running.requirement,
        status: nextStatus,
        output: (result.output || '').slice(0, 4000),
        files: task.files || [],
        durationMs: result.telemetry.durationMs || 0,
        tokens: result.telemetry.totalTokens || 0,
        timestamp: now.toISOString(),
        createdAt: now.toISOString().replace('T', ' ').slice(0, 19),
      })

      const taskFinished = progressEvent('task', `${task.id} ${nextStatus}`, {
        phase: running.phase,
        taskId: task.id,
        mcpId: task.assignedMcpId,
        status: nextStatus,
        durationMs: result.telemetry.durationMs,
      })
      running = runtime.appendTelemetry(running, {
        ...progressTelemetry(running, taskFinished),
        type: nextStatus === 'completed' ? 'task.completed' : 'task.failed',
      })
      options.onProgress?.(taskFinished, running)
      running = scheduler.reconcile(running)
      runtime.save(running)
    }

    options.onProgress?.(progressEvent('batch', `completed ${dispatchBatch.length} tasks`, {
      phase: running.phase,
      batchId,
      status: 'completed',
      snippet: dispatchBatch.map(task => task.id).join(', '),
    }), running)
  }

  const reviewArtifacts = parseReviewArtifacts(running.artifacts, running.taskGraph.tasks)
  const reviewApprovals = approvalsFromArtifacts(reviewArtifacts)
  running = scheduler.reconcile({
    ...running,
    reviewArtifacts,
    reviewApprovals,
  })

  const governanceAudit = policy.buildGovernanceAudit(running, running.reviewAssignments || [], reviewApprovals)
  options.onProgress?.(progressEvent('merge', 'running quality gate', {
    phase: running.phase,
    status: 'quality-gate',
  }), running)
  const qualityGate = await new QualityGate().runAll(options.projectRoot, running, reviewApprovals)
  options.onProgress?.(progressEvent('merge', 'running merge step', {
    phase: running.phase,
    status: 'merging',
  }), running)
  const mergeResult = await new GitMergeService(options.projectRoot).merge(running, options.workspaces)
  const recovery = !mergeResult.success
    ? await new FailureRecovery(options.projectRoot).recover(running, mergeResult.error || 'merge failed', options.workspaces)
    : []

  if (recovery.length > 0) {
    for (const item of recovery) {
      options.onProgress?.(progressEvent('recovery', `${item.step}: ${item.suggestion || item.message}`, {
        phase: running.phase,
        status: item.status,
        taskId: item.taskId,
        mcpId: item.mcpId,
      }), running)
    }
  }

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
  options.onProgress?.(progressEvent('session', `session ${finalPhase}`, {
    phase: finalPhase,
    status: finalPhase,
    snippet: mergeResult.success ? 'merge passed' : mergeResult.error || 'merge failed',
  }), finalSession)
  return finalSession
}
