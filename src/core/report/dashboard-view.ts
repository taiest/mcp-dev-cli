import type { ExecutionSession, ParallelProgressEvent } from '../../types.js'
import { MetricsAggregator } from '../telemetry/metrics-aggregator.js'

function blockedReasons(session: ExecutionSession, task: ExecutionSession['taskGraph']['tasks'][number]): string[] {
  const contractReasons = task.artifacts
    .filter(item => item.startsWith('blocked-by-contract:'))
    .map(item => item.replace('blocked-by-contract:', '等待契约通过：'))
  if (contractReasons.length > 0) return contractReasons

  const incompleteDependencies = task.dependencies.filter(dep => {
    const dependency = session.taskGraph.tasks.find(item => item.id === dep)
    return dependency ? dependency.status !== 'completed' : true
  })

  if (incompleteDependencies.length > 0) {
    return incompleteDependencies.map(dep => `等待 ${dep} 完成`)
  }

  return ['当前阻塞']
}

function telemetryToProgressEvent(event: ExecutionSession['telemetry'][number]): ParallelProgressEvent {
  return {
    kind: event.type.startsWith('worker') ? 'worker' : event.type.startsWith('task') ? 'task' : event.type.startsWith('merge') ? 'merge' : event.type.startsWith('recovery') ? 'recovery' : event.type.startsWith('session.batch') ? 'batch' : 'session',
    message: event.message,
    timestamp: event.timestamp,
    mcpId: event.mcpId,
    taskId: event.taskId,
    status: event.metadata?.status,
    snippet: event.metadata?.snippet,
    batchId: event.metadata?.batchId,
    phase: event.metadata?.phase,
    durationMs: event.durationMs,
    activeModel: event.activeModel,
  }
}

function parseJsonArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T[]
  } catch {
    return fallback
  }
}

export interface DashboardView {
  sessionId: string
  phase: string
  controller: string
  stack: string[]
  monitoring: ReturnType<MetricsAggregator['build']>['monitoring']
  startup: {
    requirement: string
    createdAt: string
    updatedAt: string
    resumable: boolean
    entryHints: string[]
  }
  summary: {
    headline: string
    nextAction: string
    nextReason: string
    blockers: string[]
    recentChange: string
    assignmentHeadline: string
    roleHeadline: string
  }
  governance: ExecutionSession['governance'] extends infer T ? NonNullable<T> : never
  governanceAudit: NonNullable<ExecutionSession['governanceAudit']>
  auditTrail: NonNullable<ExecutionSession['auditTrail']>
  reviewAssignments: NonNullable<ExecutionSession['reviewAssignments']>
  preflight: ExecutionSession['preflight']
  contractGate: ExecutionSession['contractGate']
  qualityGate: ExecutionSession['qualityGate']
  reviewArtifacts: NonNullable<ExecutionSession['reviewArtifacts']>
  reviewApprovals: NonNullable<ExecutionSession['reviewApprovals']>
  recovery: NonNullable<ExecutionSession['recovery']>
  recoverySuggestions: Array<{ step: string; action?: string; taskId?: string; mcpId?: string; suggestion?: string }>
  merge: {
    success: boolean
    order: string[]
    merged: string[]
    failed: Array<{ branch: string; error?: string }>
    conflicts: string[]
    error?: string
  }
  resumeCursor: ExecutionSession['resumeCursor']
  telemetryCount: number
  taskCounts: {
    pending: number
    ready: number
    running: number
    blocked: number
    reviewing: number
    completed: number
    failed: number
  }
  blockedTasks: Array<{ id: string; title: string; reasons: string[] }>
  activeTasks: Array<{ taskId: string; title: string; mcpId: string; lastProgressMessage: string; lastProgressAt?: string }>
  recentProgress: ParallelProgressEvent[]
  assignmentSummary: string[]
  createdRoles: Array<{ mcpId: string; file: string; role: string; tasks: string[] }>
  mcps: Array<{
    id: string
    roleType: string
    status: string
    activeModel: string
    permissions: string[]
    governancePolicy: ExecutionSession['mcps'][number]['governancePolicy']
    assignedTasks: Array<{
      id: string
      title: string
      status: string
      governanceStatus: string | undefined
      reviewAssignedTo: string[]
      approvedBy: string[]
      rejectedBy: string[]
      blockedReasons: string[]
    }>
  }>
  contracts: Array<{
    id: string
    name: string
    version: number
    validationStatus: string
    producerTaskId: string
  }>
  recentTelemetry: ExecutionSession['telemetry']
}

export function buildDashboardView(session: ExecutionSession): DashboardView {
  const taskCounts = {
    pending: session.taskGraph.tasks.filter(task => task.status === 'pending').length,
    ready: session.taskGraph.tasks.filter(task => task.status === 'ready').length,
    running: session.taskGraph.tasks.filter(task => task.status === 'running').length,
    blocked: session.taskGraph.tasks.filter(task => task.status === 'blocked').length,
    reviewing: session.taskGraph.tasks.filter(task => task.status === 'reviewing').length,
    completed: session.taskGraph.tasks.filter(task => task.status === 'completed').length,
    failed: session.taskGraph.tasks.filter(task => task.status === 'failed').length,
  }
  const mergeResult = session.artifacts.mergeResult ? JSON.parse(session.artifacts.mergeResult) as {
    success?: boolean
    mergeOrder?: string[]
    mergedBranches?: string[]
    failedBranches?: Array<{ branch: string; error?: string }>
    conflicts?: string[]
    error?: string
  } : undefined
  const metrics = new MetricsAggregator().build(session)
  const recentProgress = session.telemetry
    .filter(event => /^(task\.|worker\.|session\.batch|merge\.|recovery\.)/.test(event.type))
    .slice(-12)
    .map(telemetryToProgressEvent)
  const activeTasks = session.taskGraph.tasks
    .filter(task => task.status === 'running')
    .map(task => {
      const latest = [...session.telemetry]
        .reverse()
        .find(event => event.taskId === task.id && /^(task\.|worker\.)/.test(event.type))
      return {
        taskId: task.id,
        title: task.title,
        mcpId: task.assignedMcpId || 'none',
        lastProgressMessage: latest?.message || 'running',
        lastProgressAt: latest?.timestamp,
      }
    })
  const blockedTasks = session.taskGraph.tasks
    .filter(task => task.status === 'blocked')
    .map(task => ({ id: task.id, title: task.title, reasons: blockedReasons(session, task) }))
  const recentChange = recentProgress[recentProgress.length - 1]?.message || `session is currently ${session.phase}`
  const blockers = blockedTasks.map(task => `${task.id}: ${task.reasons.join(', ') || 'blocked'}`).slice(0, 3)
  const assignmentSummary = parseJsonArray<string>(session.artifacts.assignmentSummary, session.mcps.map(mcp => `${mcp.id} [${mcp.roleType}] waiting`))
  const createdRoles = parseJsonArray<Array<{ mcpId: string; file: string; role: string; tasks: string[] }>[number]>(session.artifacts.createdRoles, [])
  const nextAction = session.phase === 'planning'
    ? 'parallel_approve'
    : blockedTasks.length > 0
      ? 'parallel_dashboard'
      : session.phase === 'failed'
        ? 'parallel_resume'
        : session.phase === 'completed'
          ? 'parallel_report'
          : activeTasks.length > 0
            ? 'parallel_dashboard'
            : session.resumeCursor.taskIds.length > 0
              ? 'parallel_resume'
              : 'parallel_report'
  const nextReason = session.phase === 'planning'
    ? '当前计划已生成，等待用户审批后进入主控执行。'
    : blockedTasks.length > 0
      ? '当前仍有阻塞任务，优先查看阻塞原因与恢复建议。'
      : session.phase === 'failed'
        ? 'session 已失败，优先恢复或检查失败原因。'
        : session.phase === 'completed'
          ? '当前 session 已完成，适合导出本轮结果总结。'
          : activeTasks.length > 0
            ? '当前仍在运行，适合继续通过 dashboard 观察进度。'
            : session.resumeCursor.taskIds.length > 0
              ? '仍有未完成任务，可尝试恢复继续推进。'
              : '当前已无待执行任务，适合查看最终结果。'
  const headline = session.phase === 'planning'
    ? '当前执行计划已生成，等待审批后启动多 MCP 执行。'
    : blockedTasks.length > 0
      ? `当前有 ${blockedTasks.length} 个阻塞任务，需要先处理卡点。`
      : activeTasks.length > 0
        ? `当前有 ${activeTasks.length} 个任务正在运行。`
        : session.phase === 'completed'
          ? '当前 session 已完成，可以查看最终结果。'
          : `当前 session 处于 ${session.phase} 阶段。`

  return {
    sessionId: session.sessionId,
    phase: session.phase,
    controller: session.controllerMcpId,
    stack: session.stack,
    monitoring: metrics.monitoring,
    startup: {
      requirement: session.requirement,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      resumable: session.phase !== 'completed',
      entryHints: ['parallel_startup', 'parallel_preflight', 'parallel_start', 'parallel_approve', 'parallel_resume'],
    },
    summary: {
      headline,
      nextAction,
      nextReason,
      blockers,
      recentChange,
      assignmentHeadline: `已分配 ${assignmentSummary.length} 个 MCP lane`,
      roleHeadline: createdRoles.length > 0 ? `已创建 ${createdRoles.length} 个角色文件` : '角色文件待创建',
    },
    governance: session.governance || {
      status: 'pending',
      reviewRequiredTaskIds: [],
      reviewAssignedTaskIds: [],
      approvedTaskIds: [],
      rejectedTaskIds: [],
      readyForMerge: false,
    },
    governanceAudit: session.governanceAudit || [],
    auditTrail: session.auditTrail || [],
    reviewAssignments: session.reviewAssignments || [],
    preflight: session.preflight,
    contractGate: session.contractGate,
    qualityGate: session.qualityGate,
    reviewArtifacts: session.reviewArtifacts || [],
    reviewApprovals: session.reviewApprovals || [],
    recovery: session.recovery || [],
    recoverySuggestions: (session.recovery || []).map(item => ({
      step: item.step,
      action: item.action,
      taskId: item.taskId,
      mcpId: item.mcpId,
      suggestion: item.suggestion,
    })),
    merge: {
      success: Boolean(mergeResult?.success),
      order: mergeResult?.mergeOrder || [],
      merged: mergeResult?.mergedBranches || [],
      failed: mergeResult?.failedBranches || [],
      conflicts: mergeResult?.conflicts || [],
      error: mergeResult?.error,
    },
    resumeCursor: session.resumeCursor,
    telemetryCount: session.telemetry.length,
    taskCounts,
    blockedTasks,
    activeTasks,
    recentProgress,
    assignmentSummary,
    createdRoles,
    mcps: session.mcps.map(mcp => ({
      id: mcp.id,
      roleType: mcp.roleType,
      status: mcp.status,
      activeModel: mcp.activeModel,
      permissions: mcp.permissions,
      governancePolicy: mcp.governancePolicy,
      assignedTasks: session.taskGraph.tasks
        .filter(task => task.assignedMcpId === mcp.id)
        .map(task => ({
          id: task.id,
          title: task.title,
          status: task.status,
          governanceStatus: task.governanceStatus,
          reviewAssignedTo: task.reviewAssignedTo,
          approvedBy: task.approvedBy || [],
          rejectedBy: task.rejectedBy || [],
          blockedReasons: blockedReasons(session, task),
        })),
    })),
    contracts: session.contracts.map(contract => ({
      id: contract.id,
      name: contract.name,
      version: contract.version,
      validationStatus: contract.validationStatus,
      producerTaskId: contract.producerTaskId,
    })),
    recentTelemetry: session.telemetry.slice(-10),
  }
}
