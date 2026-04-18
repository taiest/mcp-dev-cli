import { join } from 'node:path'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { ReportBuilder } from '../core/report/report-builder.js'
import { exportReport } from '../core/report/report-exporter.js'
import { PARALLEL_REPORT_FILE } from '../types.js'

export async function exportParallelReport(projectRoot: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) {
    return [
      '🧾 Parallel Report',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '当前没有可导出的 parallel session report。',
      '',
      '建议下一步：',
      '- 先运行 parallel_startup，确认当前项目是否已有可恢复 session。',
      '- 如果只是想看当前状态，运行 parallel_dashboard。',
      '- 如果还没有启动 session，运行 parallel_start。',
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
