import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { ReportBuilder } from '../core/report/report-builder.js'
import { exportReport } from '../core/report/report-exporter.js'

export async function exportParallelReport(projectRoot: string): Promise<string> {
  const session = new SessionRuntime(projectRoot).load()
  if (!session) return '当前没有可导出的 parallel session report。'
  return exportReport(new ReportBuilder().build(session))
}
