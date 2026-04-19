import type { ExecutionSession, ExecutionSummaryReport } from '../../types.js'
import { MetricsAggregator } from '../telemetry/metrics-aggregator.js'
import { PreflightScanner } from '../preflight/preflight-scanner.js'

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
    const scanner = new PreflightScanner()
    const config = scanner.scanConfig(session.projectRoot)
    const completeness = scanner.scanCompleteness(session.projectRoot)
    const report = this.aggregator.build(session)
    const blockedReasons = session.taskGraph.tasks
      .filter(task => task.status === 'blocked')
      .flatMap(task => task.artifacts.filter(item => item.startsWith('blocked-by-contract:')).map(reason => `${task.id}:${reason}`))
    const mergeSummary = formatMergeSummary(report)
    const monitoringSummary = formatMonitoringSummary(report)
    const planningAnalysis = session.taskGraph.analysis
      ? [
          `plan-kind=${session.taskGraph.analysis.kind}`,
          `landing=${session.taskGraph.analysis.likelyLandingZones.join(', ') || 'none'}`,
          `roles=${session.taskGraph.analysis.recommendedRoles.join(', ') || 'none'}`,
          `clarity=${session.taskGraph.analysis.clarity}`,
          `risk=${session.taskGraph.analysis.riskLevel}`,
        ].join(' | ')
      : 'plan=none'
    const controllerSummary = session.controllerPlan
      ? `ctrl-plan: lanes=${session.controllerPlan.recommendedExecutionLaneCount} mcps=${session.controllerPlan.recommendedTotalMcpCount} parallelism=${session.controllerPlan.estimatedParallelism} strategy=${session.controllerPlan.decompositionStrategy}`
      : 'ctrl-plan=none'
    const laneSummary = (session.laneStates || []).length > 0
      ? `lanes=${session.laneStates!.filter(l => l.roleType !== 'controller').map(l => `${l.mcpId}:${l.roleType}[${l.status}]`).join(', ')}`
      : 'lanes=none'
    const decisionCount = (session.controllerDecisions || []).length
    const reassignmentSummary = (session.reassignmentHistory || []).length > 0
      ? `reassignments=${session.reassignmentHistory!.map(item => `${item.taskId}:${item.fromMcpId}->${item.toMcpId}`).join(', ')}`
      : 'reassignments=none'

    return {
      ...report,
      startup: {
        configPassed: config.passed,
        completeness,
        planning: session.taskGraph.analysis,
      },
      rows: report.rows.map(row => {
        const relatedBlocked = blockedReasons.filter(reason => session.taskGraph.tasks.some(task => task.assignedMcpId === row.mcpId && reason.startsWith(`${task.id}:`)))
        const extras = [mergeSummary, monitoringSummary, planningAnalysis, controllerSummary, laneSummary, `decisions=${decisionCount}`, reassignmentSummary, `governance=${report.governanceStatus || 'pending'}`]
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
