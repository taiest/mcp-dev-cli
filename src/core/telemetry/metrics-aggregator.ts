import type {
  ExecutionSession,
  ExecutionSummaryReport,
  McpExecutionReportRow,
  MonitoringSummary,
  TelemetryBreakdown,
} from '../../types.js'

function eventBreakdown(session: ExecutionSession): TelemetryBreakdown {
  return session.telemetry.reduce<TelemetryBreakdown>((acc, event) => {
    if (event.type.startsWith('session.')) acc.sessionLifecycle += 1
    else if (event.type.startsWith('task.')) acc.taskLifecycle += 1
    else if (event.type.startsWith('worker.')) acc.workerLifecycle += 1
    else if (event.type.startsWith('review.')) acc.reviewLifecycle += 1
    else if (event.type.startsWith('merge.')) acc.mergeLifecycle += 1
    else if (event.type.startsWith('recovery.')) acc.recoveryLifecycle += 1
    else acc.other += 1
    return acc
  }, {
    sessionLifecycle: 0,
    taskLifecycle: 0,
    workerLifecycle: 0,
    reviewLifecycle: 0,
    mergeLifecycle: 0,
    recoveryLifecycle: 0,
    other: 0,
  })
}

function buildMonitoringSummary(session: ExecutionSession): MonitoringSummary {
  const activeModelUsage = Object.entries(session.telemetry.reduce<Record<string, number>>((acc, event) => {
    const model = event.activeModel || 'unknown'
    acc[model] = (acc[model] || 0) + 1
    return acc
  }, {})).map(([model, count]) => ({ model, count }))

  return {
    totalDurationMs: session.telemetry.reduce((sum, event) => sum + (event.durationMs || 0), 0),
    totalTokens: session.telemetry.reduce((sum, event) => sum + (event.totalTokens || 0), 0),
    telemetryCount: session.telemetry.length,
    warningCount: session.telemetry.filter(event => event.type.includes('warning')).length,
    failureCount: session.telemetry.filter(event => event.type.includes('failed')).length,
    activeModelUsage,
    eventBreakdown: eventBreakdown(session),
    taskRows: session.taskGraph.tasks.map(task => ({
      taskId: task.id,
      title: task.title,
      assignedMcpId: task.assignedMcpId,
      roleType: task.roleType,
      status: task.status,
      governanceStatus: task.governanceStatus,
      durationMs: session.telemetry
        .filter(event => event.taskId === task.id)
        .reduce((sum, event) => sum + (event.durationMs || 0), 0),
      totalTokens: session.telemetry
        .filter(event => event.taskId === task.id)
        .reduce((sum, event) => sum + (event.totalTokens || 0), 0),
    })),
  }
}

export class MetricsAggregator {
  build(session: ExecutionSession): ExecutionSummaryReport {
    const taskEvents = session.telemetry.filter(event => event.taskId)
    const totalDurationMs = taskEvents.reduce((sum, event) => sum + (event.durationMs || 0), 0)
    const totalTokens = session.telemetry.reduce((sum, event) => sum + (event.totalTokens || 0), 0)
    const merge = session.artifacts.mergeResult ? JSON.parse(session.artifacts.mergeResult) as {
      success?: boolean
      mergeOrder?: string[]
      mergedBranches?: string[]
      failedBranches?: Array<{ branch: string; error?: string }>
      conflicts?: string[]
      error?: string
    } : undefined
    const monitoring = buildMonitoringSummary(session)

    const rows: McpExecutionReportRow[] = session.mcps.map(mcp => {
      const mcpTasks = session.taskGraph.tasks.filter(task => task.assignedMcpId === mcp.id)
      const mcpEvents = session.telemetry.filter(event => event.mcpId === mcp.id)
      return {
        mcpId: mcp.id,
        roleName: mcp.roleType,
        workContent: mcpTasks.map(task => `${task.title}[${task.governanceStatus || 'pending'}]`).join(', ') || 'none',
        progressStatus: session.governance?.status && session.controllerMcpId === mcp.id
          ? `${mcp.status}/${session.governance.status}`
          : mcp.status,
        durationMs: mcpEvents.reduce((sum, event) => sum + (event.durationMs || 0), 0),
        totalTokens: mcpEvents.reduce((sum, event) => sum + (event.totalTokens || 0), 0),
        activeModel: mcp.activeModel,
      }
    })

    return {
      sessionId: session.sessionId,
      requirement: session.requirement,
      totalDurationMs,
      totalTokens,
      completedCount: session.taskGraph.tasks.filter(task => task.status === 'completed').length,
      failedCount: session.taskGraph.tasks.filter(task => task.status === 'failed').length,
      blockedCount: session.taskGraph.tasks.filter(task => task.status === 'blocked').length,
      governanceStatus: session.governance?.status,
      telemetryCount: monitoring.telemetryCount,
      warningCount: monitoring.warningCount,
      failureCount: monitoring.failureCount,
      monitoring,
      merge: {
        success: Boolean(merge?.success),
        order: merge?.mergeOrder || [],
        merged: merge?.mergedBranches || [],
        failed: merge?.failedBranches || [],
        conflicts: merge?.conflicts || [],
        error: merge?.error,
      },
      rows,
    }
  }
}
