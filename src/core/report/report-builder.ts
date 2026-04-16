import type { ExecutionSession, ExecutionSummaryReport } from '../../types.js'
import { MetricsAggregator } from '../telemetry/metrics-aggregator.js'

function formatMergeSummary(report: ExecutionSummaryReport): string {
  const failed = report.merge.failed.map(item => `${item.branch}${item.error ? `(${item.error})` : ''}`).join(', ') || 'none'
  return [
    `merge-order=${report.merge.order.join(', ') || 'none'}`,
    `merged=${report.merge.merged.join(', ') || 'none'}`,
    `merge-failed=${failed}`,
    `merge-conflicts=${report.merge.conflicts.join(', ') || 'none'}`,
  ].join(' | ')
}

function formatMonitoringSummary(report: ExecutionSummaryReport): string {
  const monitoring = report.monitoring
  if (!monitoring) return 'monitoring=none'
  return [
    `telemetry=${monitoring.telemetryCount}`,
    `warnings=${monitoring.warningCount}`,
    `failures=${monitoring.failureCount}`,
    `models=${monitoring.activeModelUsage.map(item => `${item.model}:${item.count}`).join(', ') || 'none'}`,
  ].join(' | ')
}

export class ReportBuilder {
  private aggregator = new MetricsAggregator()

  build(session: ExecutionSession): ExecutionSummaryReport {
    const report = this.aggregator.build(session)
    const blockedReasons = session.taskGraph.tasks
      .filter(task => task.status === 'blocked')
      .flatMap(task => task.artifacts.filter(item => item.startsWith('blocked-by-contract:')).map(reason => `${task.id}:${reason}`))
    const mergeSummary = formatMergeSummary(report)
    const monitoringSummary = formatMonitoringSummary(report)

    return {
      ...report,
      rows: report.rows.map(row => {
        const relatedBlocked = blockedReasons.filter(reason => session.taskGraph.tasks.some(task => task.assignedMcpId === row.mcpId && reason.startsWith(`${task.id}:`)))
        const extras = [mergeSummary, monitoringSummary, `governance=${report.governanceStatus || 'pending'}`]
        if (relatedBlocked.length > 0) {
          extras.unshift(`blocked=${relatedBlocked.join(', ')}`)
        }
        return {
          ...row,
          workContent: `${row.workContent} | ${extras.join(' | ')}`,
        }
      }),
    }
  }
}
