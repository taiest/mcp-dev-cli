import type { ExecutionSummaryReport } from '../../types.js'

export function exportReport(report: ExecutionSummaryReport): string {
  const lines = [
    `Session: ${report.sessionId}`,
    `Governance: ${report.governanceStatus || 'pending'}`,
    `Total duration: ${report.totalDurationMs}`,
    `Total tokens: ${report.totalTokens}`,
    `Telemetry count: ${report.telemetryCount || 0}`,
    `Warnings: ${report.warningCount || 0}`,
    `Failures: ${report.failureCount || 0}`,
    `Completed tasks: ${report.completedCount}`,
    `Failed tasks: ${report.failedCount}`,
    `Blocked tasks: ${report.blockedCount}`,
    `Merge success: ${report.merge.success}`,
    `Merge order: ${report.merge.order.join(', ') || 'none'}`,
    `Merged branches: ${report.merge.merged.join(', ') || 'none'}`,
    `Failed branches: ${report.merge.failed.map(item => `${item.branch}${item.error ? `(${item.error})` : ''}`).join(', ') || 'none'}`,
    `Merge conflicts: ${report.merge.conflicts.join(', ') || 'none'}`,
    `Merge error: ${report.merge.error || 'none'}`,
    `Model usage: ${report.monitoring?.activeModelUsage.map(item => `${item.model}:${item.count}`).join(', ') || 'none'}`,
    `Event breakdown: ${report.monitoring ? [
      `session=${report.monitoring.eventBreakdown.sessionLifecycle}`,
      `task=${report.monitoring.eventBreakdown.taskLifecycle}`,
      `worker=${report.monitoring.eventBreakdown.workerLifecycle}`,
      `review=${report.monitoring.eventBreakdown.reviewLifecycle}`,
      `merge=${report.monitoring.eventBreakdown.mergeLifecycle}`,
      `recovery=${report.monitoring.eventBreakdown.recoveryLifecycle}`,
      `other=${report.monitoring.eventBreakdown.other}`,
    ].join(', ') : 'none'}`,
    '',
    'Task monitoring:',
  ]

  for (const row of report.monitoring?.taskRows || []) {
    lines.push(
      `${row.taskId} | ${row.title} | ${row.roleType} | ${row.status} | governance=${row.governanceStatus || 'pending'} | mcp=${row.assignedMcpId || 'none'} | duration=${row.durationMs} | tokens=${row.totalTokens}`
    )
  }

  lines.push('', 'MCP rows:')

  for (const row of report.rows) {
    lines.push(
      `${row.mcpId} | ${row.roleName} | ${row.progressStatus} | duration=${row.durationMs} | tokens=${row.totalTokens} | work=${row.workContent} | model=${row.activeModel}`
    )
  }

  return lines.join('\n')
}
