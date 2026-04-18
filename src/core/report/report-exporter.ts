import type { ExecutionSummaryReport } from '../../types.js'
import { renderExecutionReport } from '../terminal/renderers.js'

export function exportReport(report: ExecutionSummaryReport): string {
  return renderExecutionReport(report)
}
