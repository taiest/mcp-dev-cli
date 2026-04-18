import { join } from 'node:path'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { ReportBuilder } from '../core/report/report-builder.js'
import { exportReport } from '../core/report/report-exporter.js'
import { PARALLEL_REPORT_FILE } from '../types.js'

export async function exportParallelReport(projectRoot: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) {
    const startup = await runtime.buildStartupFlow()
    return [
      '🧾 Parallel Report',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '当前没有可导出的 parallel session report。',
      '',
      'What To Do Next',
      ...[
        startup.summary,
        `development: ${startup.developmentStatus}`,
        `completeness: ${startup.completeness.status}`,
        `recommended tool: ${startup.recommendedAction}`,
        `next: ${startup.nextActions.join(', ') || 'none'}`,
      ].map(line => `  ${line}`),
    ].join('\n')
  }

  const report = new ReportBuilder().build(session)
  runtime.saveReport(report)

  return [
    exportReport(report),
    '',
    'Export',
    `  path  ${join(projectRoot, PARALLEL_REPORT_FILE)}`,
    '  file  report.json',
  ].join('\n')
}
