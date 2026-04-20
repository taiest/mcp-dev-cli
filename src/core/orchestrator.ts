import type {
  ContractArtifact,
  ControllerDecision,
  ExecutionSession,
  McpLaneState,
  McpMessage,
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
import { DEFAULT_CONFIG } from '../types.js'
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

function nowIso(): string {
  return new Date().toISOString()
}

function progressEvent(kind: ParallelProgressEvent['kind'], message: string, partial: Omit<ParallelProgressEvent, 'kind' | 'message' | 'timestamp'> = {}): ParallelProgressEvent {
  return {
    kind,
    message,
    timestamp: nowIso(),
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
    totalTokens: event.totalTokens,
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

function mcpMsg(from: string, to: string, type: McpMessage['type'], content: string, extra?: Partial<McpMessage>): McpMessage {
  return { id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: nowIso(), from, to, type, content, ...extra }
}

function appendMsg(session: ExecutionSession, msg: McpMessage): ExecutionSession {
  return { ...session, messageLog: [...(session.messageLog || []), msg] }
}

function buildControllerDecision(
  session: ExecutionSession,
  type: ControllerDecision['type'],
  summary: string,
  extra: Partial<ControllerDecision> = {}
): ControllerDecision {
  return {
    id: `decision:${session.sessionId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
    timestamp: nowIso(),
    type,
    summary,
    ...extra,
  }
}

function appendControllerDecision(session: ExecutionSession, decision: ControllerDecision): ExecutionSession {
  return {
    ...session,
    controllerDecisions: [...(session.controllerDecisions || []), decision],
  }
}

function recalculateLaneStates(session: ExecutionSession): McpLaneState[] {
  const previous = new Map((session.laneStates || []).map(lane => [lane.mcpId, lane]))
  return session.mcps.map(mcp => {
    const assignedTasks = session.taskGraph.tasks.filter(task => task.assignedMcpId === mcp.id)
    const runningTask = assignedTasks.find(task => task.status === 'running')
    const readyTask = assignedTasks.find(task => task.status === 'ready' || task.status === 'pending')
    const latestTask = assignedTasks[assignedTasks.length - 1]
    const activeTask = runningTask || readyTask || latestTask
    const prev = previous.get(mcp.id)
    const latestMessage = [...(session.messageLog || [])]
      .reverse()
      .find(item => item.from === mcp.id || item.to === mcp.id)

    return {
      mcpId: mcp.id,
      roleType: mcp.roleType,
      status: mcp.status,
      createdAt: prev?.createdAt || session.createdAt,
      workspaceId: mcp.workspaceId,
      currentTaskId: activeTask?.id,
      latestReply: latestMessage?.content || prev?.latestReply || (activeTask ? `${activeTask.id}: ${activeTask.status}` : 'idle'),
      currentElapsedMs: runningTask ? prev?.currentElapsedMs || 0 : 0,
      currentTokens: runningTask ? prev?.currentTokens || 0 : 0,
      cumulativeElapsedMs: prev?.cumulativeElapsedMs || 0,
      cumulativeTokens: prev?.cumulativeTokens || 0,
      completedTaskCount: assignedTasks.filter(task => task.status === 'completed').length,
      queueDepth: assignedTasks.filter(task => task.status !== 'completed' && task.status !== 'failed').length,
    }
  })
}

function withLaneSnapshot(session: ExecutionSession): ExecutionSession {
  return {
    ...session,
    laneStates: recalculateLaneStates(session),
  }
}

function updateLaneState(
  session: ExecutionSession,
  mcpId: string,
  patch: Partial<McpLaneState> | ((lane: McpLaneState) => McpLaneState)
): ExecutionSession {
  const lanes = recalculateLaneStates(session)
  return {
    ...session,
    laneStates: lanes.map(lane => {
      if (lane.mcpId !== mcpId) return lane
      return typeof patch === 'function' ? patch(lane) : { ...lane, ...patch }
    }),
  }
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

function dispatchableTasks(session: ExecutionSession, policy: PolicyEngine): OrchestratedTask[] {
  return session.taskGraph.tasks.filter(task => {
    if (task.status !== 'ready' || !task.assignedMcpId) return false
    const node = session.mcps.find(item => item.id === task.assignedMcpId)
    if (!node) return false
    return node.status !== 'running'
      && node.status !== 'failed'
      && policy.canExecuteTask(node, task, session.controllerMcpId)
  })
}

function hasIdleEligibleLane(session: ExecutionSession, policy: PolicyEngine): boolean {
  return session.mcps.some(node =>
    node.id !== session.controllerMcpId
    && node.status !== 'running'
    && node.status !== 'failed'
    && session.taskGraph.tasks.some(task => task.status === 'ready' && task.assignedMcpId === node.id && policy.canExecuteTask(node, task, session.controllerMcpId))
  )
}

function applyTaskRunning(session: ExecutionSession, task: OrchestratedTask): ExecutionSession {
  const updatedTaskGraph: TaskGraph = {
    ...session.taskGraph,
    tasks: session.taskGraph.tasks.map(item => item.id === task.id ? { ...item, status: 'running' } : item),
  }
  const updatedMcps: McpNode[] = session.mcps.map(item =>
    item.id === task.assignedMcpId
      ? { ...item, status: 'running' as McpNodeStatus }
      : item
  )

  return withLaneSnapshot({
    ...session,
    taskGraph: updatedTaskGraph,
    mcps: updatedMcps,
    resumeCursor: {
      phase: session.phase,
      taskIds: updatedTaskGraph.tasks.filter(item => item.status !== 'completed').map(item => item.id),
    },
  })
}

function applyTaskStatus(session: ExecutionSession, taskId: string, status: OrchestratedTaskStatus, output: string, failureReason?: string): ExecutionSession {
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

  return withLaneSnapshot({
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
  })
}

function missingWorkerTelemetry(sessionId: string, task: OrchestratedTask, mcpId?: string, activeModel?: string): TelemetryEvent {
  return {
    id: `evt-${Date.now()}-${task.id}`,
    timestamp: nowIso(),
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

async function executeSingleTask(options: {
  sessionSnapshot: ExecutionSession
  runningSession: ExecutionSession
  task: OrchestratedTask
  workspaces: Record<string, WorkspaceDescriptor>
  contracts: ContractArtifact[]
  context: string
  worker: WorkerRunner
  runtime: SessionRuntime
  onProgress?: (event: ParallelProgressEvent, session: ExecutionSession) => void
}): Promise<{ session: ExecutionSession; shouldContinue: boolean }> {
  const { sessionSnapshot, task, workspaces, contracts, context, worker, runtime, onProgress } = options
  let running = options.runningSession
  const node = sessionSnapshot.mcps.find(item => item.id === task.assignedMcpId)
  const workspace = (() => {
    if (task.roleType !== 'reviewer') {
      return task.assignedMcpId ? workspaces[task.assignedMcpId] : undefined
    }

    const reviewTarget = sessionSnapshot.taskGraph.tasks.find(item =>
      item.reviewRequired
      && item.status === 'completed'
      && task.dependencies.includes(item.id)
      && item.assignedMcpId
    )
    return reviewTarget?.assignedMcpId ? workspaces[reviewTarget.assignedMcpId] : (task.assignedMcpId ? workspaces[task.assignedMcpId] : undefined)
  })()

  if (!node || !workspace) {
    const telemetry = missingWorkerTelemetry(sessionSnapshot.sessionId, task, task.assignedMcpId, node?.activeModel)
    running = applyTaskStatus(running, task.id, 'failed', '', telemetry.message)
    running = updateLaneState(running, task.assignedMcpId || 'unknown', lane => ({
      ...lane,
      latestReply: telemetry.message,
      currentElapsedMs: 0,
      currentTokens: 0,
    }))
    running = runtime.appendTelemetry(running, telemetry)
    onProgress?.(progressEvent('controller', `MCP-01 标记 ${task.id} 失败：缺少 workspace`, {
      phase: running.phase,
      taskId: task.id,
      mcpId: task.assignedMcpId,
      status: 'failed',
      snippet: telemetry.message,
    }), running)
    return { session: running, shouldContinue: false }
  }

  const result = await worker.run(sessionSnapshot, node, task, workspace, contracts, context, event => {
    const telemetry = progressTelemetry(sessionSnapshot, event)
    running = runtime.appendTelemetry(running, telemetry)
    if (event.status === 'started') {
      running = appendMsg(running, mcpMsg(task.assignedMcpId || 'unknown', sessionSnapshot.controllerMcpId, 'ack', '收到指令，分析后执行。', { taskId: task.id }))
      running = updateLaneState(running, task.assignedMcpId || 'unknown', lane => ({
        ...lane,
        latestReply: '收到指令，分析后执行。',
        currentElapsedMs: 0,
        currentTokens: 0,
      }))
    } else {
      running = updateLaneState(running, task.assignedMcpId || 'unknown', lane => ({
        ...lane,
        latestReply: event.snippet || event.message,
        currentElapsedMs: event.durationMs ?? lane.currentElapsedMs,
        currentTokens: event.totalTokens ?? lane.currentTokens,
      }))
    }
    onProgress?.(event, running)
  })

  let nextStatus: OrchestratedTaskStatus = result.success ? 'completed' : 'failed'
  const assignmentEngine = new AssignmentEngine()

  if (!result.success && (task.reassignmentCount || 0) < 2) {
    const replacement = assignmentEngine.pickReplacement(task, running.mcps, task.assignedMcpId)
    if (replacement) {
      const record: TaskReassignmentRecord = {
        taskId: task.id,
        fromMcpId: task.assignedMcpId || 'unknown',
        toMcpId: replacement.id,
        reason: result.telemetry.message || 'task failed, auto-reassigned',
        timestamp: nowIso(),
      }
      running = withLaneSnapshot({
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
        mcps: running.mcps.map(mcp => mcp.id === (task.assignedMcpId || 'unknown') ? { ...mcp, status: 'idle' } : mcp),
      })
      running = appendControllerDecision(running, buildControllerDecision(running, 'reassign-task', `MCP-01 将 ${task.id} 从 ${task.assignedMcpId} 转派给 ${replacement.id}`, {
        taskId: task.id,
        fromMcpId: task.assignedMcpId,
        toMcpId: replacement.id,
        mcpId: replacement.id,
        reason: result.telemetry.message || 'task failed, auto-reassigned',
      }))
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
      running = appendMsg(running, mcpMsg(running.controllerMcpId, replacement.id, 'reassign', `${task.id} 从 ${task.assignedMcpId} 转派: ${result.telemetry.message || 'failed'}`, { taskId: task.id }))
      running = updateLaneState(running, task.assignedMcpId || 'unknown', lane => ({
        ...lane,
        latestReply: `转派 ${task.id} 到 ${replacement.id}`,
        currentTaskId: undefined,
        currentElapsedMs: 0,
        currentTokens: 0,
      }))
      running = updateLaneState(running, replacement.id, lane => ({
        ...lane,
        latestReply: `收到转派任务 ${task.id}`,
      }))
      onProgress?.(progressEvent('controller', `MCP-01 检测 ${task.id} 失败，立即转派 ${task.assignedMcpId} → ${replacement.id}`, {
        phase: running.phase,
        taskId: task.id,
        mcpId: replacement.id,
        status: 'reassigned',
        snippet: result.telemetry.message,
      }), running)
      runtime.save(running)
      return { session: running, shouldContinue: true }
    }
  }

  running = applyTaskStatus(running, task.id, nextStatus, result.output, result.success ? undefined : result.telemetry.message)
  running = runtime.appendTelemetry(running, result.telemetry)
  running = runtime.appendAudit(running, [
    taskAudit(running.sessionId, task, 'execute-task', result.success ? 'passed' : 'failed', result.telemetry.message),
  ])

  const now = new Date()
  const store = new SessionStore(sessionSnapshot.projectRoot)
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

  const mcpId = task.assignedMcpId || 'unknown'
  const resultContent = result.success
    ? `${task.id} 执行完成 | 耗时 ${result.telemetry.durationMs || 0}ms | tokens ${result.telemetry.totalTokens || 0}`
    : `${task.id} 执行失败: ${(result.telemetry.message || '').slice(0, 200)}`
  running = appendMsg(running, mcpMsg(mcpId, running.controllerMcpId, 'result', resultContent, {
    taskId: task.id,
    durationMs: result.telemetry.durationMs,
    tokens: result.telemetry.totalTokens,
  }))
  running = updateLaneState(running, mcpId, lane => ({
    ...lane,
    latestReply: resultContent,
    currentElapsedMs: 0,
    currentTokens: 0,
    cumulativeElapsedMs: lane.cumulativeElapsedMs + (result.telemetry.durationMs || 0),
    cumulativeTokens: lane.cumulativeTokens + (result.telemetry.totalTokens || 0),
  }))

  const taskFinished = progressEvent('task', `${task.id} ${nextStatus}`, {
    phase: running.phase,
    taskId: task.id,
    mcpId: task.assignedMcpId,
    status: nextStatus,
    durationMs: result.telemetry.durationMs,
    totalTokens: result.telemetry.totalTokens,
  })
  running = runtime.appendTelemetry(running, {
    ...progressTelemetry(running, taskFinished),
    type: nextStatus === 'completed' ? 'task.completed' : 'task.failed',
  })
  onProgress?.(taskFinished, running)

  running = schedulerReconcilePersist(running, runtime)
  return { session: running, shouldContinue: nextStatus === 'completed' }
}

function schedulerReconcilePersist(session: ExecutionSession, runtime: SessionRuntime): ExecutionSession {
  const scheduler = new Scheduler()
  const reconciled = withLaneSnapshot(scheduler.reconcile(session))
  runtime.save(reconciled)
  return reconciled
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
  maxConcurrency?: number
  onProgress?: (event: ParallelProgressEvent, session: ExecutionSession) => void
}): Promise<ExecutionSession> {
  const runtime = new SessionRuntime(options.projectRoot)
  const scheduler = new Scheduler()
  const policy = new PolicyEngine()
  const worker = new WorkerRunner()
  let running = withLaneSnapshot(options.session)
  const MAX_CONCURRENCY = options.maxConcurrency ?? DEFAULT_CONFIG.maxConcurrency

  // Shared mutable ref so parallel onProgress callbacks all update the same session
  const shared = { running }

  function dispatchTask(task: OrchestratedTask) {
    const assignedLane = shared.running.mcps.find(item => item.id === task.assignedMcpId)
    shared.running = appendControllerDecision(shared.running, buildControllerDecision(shared.running, 'assign-task', `MCP-01 将 ${task.id} 派给 ${task.assignedMcpId}`, {
      taskId: task.id,
      toMcpId: task.assignedMcpId,
      mcpId: task.assignedMcpId,
      reason: `任务角色 ${task.roleType}，主控按 lane 可用性与角色匹配立即派发。`,
    }))
    shared.running = appendMsg(shared.running, mcpMsg(shared.running.controllerMcpId, task.assignedMcpId || 'unknown', 'assign', `${task.id}: ${task.title}`, { taskId: task.id }))
    shared.running = applyTaskRunning(shared.running, task)
    shared.running = updateLaneState(shared.running, task.assignedMcpId || 'unknown', lane => ({
      ...lane,
      currentTaskId: task.id,
      latestReply: `${task.id}: assigned`,
      currentElapsedMs: 0,
      currentTokens: 0,
    }))

    const controllerDispatch = progressEvent('controller', `MCP-01 派发 ${task.id} → ${task.assignedMcpId}${assignedLane ? ` [${assignedLane.roleType}]` : ''}`, {
      phase: shared.running.phase,
      taskId: task.id,
      mcpId: task.assignedMcpId,
      status: 'dispatching',
      snippet: `${task.title} | ${buildReadyRoleSummary(shared.running)}`,
    })
    shared.running = runtime.appendTelemetry(shared.running, progressTelemetry(shared.running, controllerDispatch))
    options.onProgress?.(controllerDispatch, shared.running)

    const taskStarted = progressEvent('task', `${task.id} started on ${task.assignedMcpId || 'none'}`, {
      phase: shared.running.phase,
      taskId: task.id,
      mcpId: task.assignedMcpId,
      status: 'running',
    })
    shared.running = runtime.appendTelemetry(shared.running, {
      ...progressTelemetry(shared.running, taskStarted),
      type: 'task.started',
    })
    options.onProgress?.(taskStarted, shared.running)
    runtime.save(shared.running)

    const snapshot = shared.running
    return executeSingleTask({
      sessionSnapshot: snapshot,
      runningSession: shared.running,
      task,
      workspaces: options.workspaces,
      contracts: options.contracts,
      context: options.context,
      worker,
      runtime,
      onProgress: (event, _session) => {
        // Merge worker progress into shared state (JS single-threaded, safe)
        options.onProgress?.(event, shared.running)
      },
    })
  }

  const inFlight = new Map<string, Promise<{ taskId: string; result: { session: ExecutionSession; shouldContinue: boolean } }>>()

  while (true) {
    shared.running = schedulerReconcilePersist(shared.running, runtime)
    options.onProgress?.(progressEvent('session', `phase=${shared.running.phase} controller scan`, {
      phase: shared.running.phase,
      status: shared.running.phase,
      snippet: `${buildReadyRoleSummary(shared.running)} | ${buildRunningMcpSummary(shared.running)}`,
    }), shared.running)

    // Fill up to MAX_CONCURRENCY
    const available = dispatchableTasks(shared.running, policy)
    const slots = MAX_CONCURRENCY - inFlight.size
    const batch = available.slice(0, slots)

    for (const task of batch) {
      const promise = dispatchTask(task).then(result => ({ taskId: task.id, result }))
      inFlight.set(task.id, promise)
    }

    if (inFlight.size === 0) {
      if (hasIdleEligibleLane(shared.running, policy)) continue
      break
    }

    // Wait for any one task to complete
    const { taskId, result } = await Promise.race(inFlight.values())
    inFlight.delete(taskId)

    // Merge completed task's state changes into shared.running
    const completedTask = result.session.taskGraph.tasks.find(t => t.id === taskId)
    if (completedTask) {
      // Only propagate 'failed' phase when no tasks are still in flight
      const mergedPhase = result.session.phase === 'failed' && inFlight.size > 0
        ? shared.running.phase
        : result.session.phase
      shared.running = {
        ...shared.running,
        phase: mergedPhase,
        taskGraph: {
          ...shared.running.taskGraph,
          tasks: shared.running.taskGraph.tasks.map(t => t.id === taskId ? completedTask : t),
        },
        mcps: shared.running.mcps.map(mcp => {
          const updated = result.session.mcps.find(m => m.id === mcp.id && m.id === completedTask.assignedMcpId)
          return updated || mcp
        }),
        artifacts: { ...shared.running.artifacts, ...Object.fromEntries(Object.entries(result.session.artifacts).filter(([k]) => k.includes(taskId))) },
        telemetry: [...shared.running.telemetry, ...result.session.telemetry.slice(shared.running.telemetry.length)],
        auditTrail: [...(shared.running.auditTrail || []), ...(result.session.auditTrail || []).slice((shared.running.auditTrail || []).length)],
        messageLog: [...(shared.running.messageLog || []), ...(result.session.messageLog || []).slice((shared.running.messageLog || []).length)],
        laneStates: shared.running.laneStates?.map(lane => {
          const updated = result.session.laneStates?.find(l => l.mcpId === lane.mcpId && l.mcpId === completedTask.assignedMcpId)
          return updated || lane
        }),
        reassignmentHistory: [...(shared.running.reassignmentHistory || []), ...(result.session.reassignmentHistory || []).slice((shared.running.reassignmentHistory || []).length)],
        controllerDecisions: [...(shared.running.controllerDecisions || []), ...(result.session.controllerDecisions || []).slice((shared.running.controllerDecisions || []).length)],
        resumeCursor: {
          phase: shared.running.phase,
          taskIds: shared.running.taskGraph.tasks.filter(t => {
            const effective = t.id === taskId ? completedTask : t
            return effective.status !== 'completed'
          }).map(t => t.id),
        },
      }
      shared.running = withLaneSnapshot(shared.running)
    }

    if (result.shouldContinue) {
      shared.running = schedulerReconcilePersist(shared.running, runtime)
      const newlyReady = shared.running.taskGraph.tasks.filter(task => task.status === 'ready').map(task => task.id)
      if (newlyReady.length > 0) {
        const unlocked = progressEvent('controller', `MCP-01 发现新解锁任务: ${newlyReady.join(', ')}`, {
          phase: shared.running.phase,
          status: 'ready',
          snippet: buildReadyRoleSummary(shared.running),
        })
        shared.running = runtime.appendTelemetry(shared.running, progressTelemetry(shared.running, unlocked))
        options.onProgress?.(unlocked, shared.running)
      }
    }
  }

  running = shared.running

  const reviewArtifacts = parseReviewArtifacts(running.artifacts, running.taskGraph.tasks)
  const reviewApprovals = approvalsFromArtifacts(reviewArtifacts)
  running = scheduler.reconcile({
    ...running,
    reviewArtifacts,
    reviewApprovals,
  })
  running = withLaneSnapshot(running)

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

  let finalSession: ExecutionSession = {
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
  }
  finalSession = withLaneSnapshot(finalSession)
  finalSession = appendControllerDecision(finalSession, buildControllerDecision(finalSession, 'controller-note', `MCP-01 完成本轮 session，状态 ${finalPhase}`, {
    mcpId: finalSession.controllerMcpId,
    reason: mergeResult.success ? 'merge passed' : mergeResult.error || 'merge failed',
  }))
  finalSession = runtime.appendAudit(finalSession, auditRecords)
  runtime.save(finalSession)
  options.onProgress?.(progressEvent('session', `session ${finalPhase}`, {
    phase: finalPhase,
    status: finalPhase,
    snippet: mergeResult.success ? 'merge passed' : mergeResult.error || 'merge failed',
  }), finalSession)
  return finalSession
}
