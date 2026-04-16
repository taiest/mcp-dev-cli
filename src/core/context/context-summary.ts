import type { ContextSummary } from '../../types.js'

export function buildContextSummary(summary: ContextSummary | null): string {
  if (!summary) return ''
  return [
    summary.goal ? `目标: ${summary.goal}` : '',
    summary.phase ? `阶段: ${summary.phase}` : '',
    summary.constraints.length > 0 ? `约束: ${summary.constraints.join('；')}` : '',
    summary.risks.length > 0 ? `风险: ${summary.risks.join('；')}` : '',
    summary.nextSteps.length > 0 ? `下一步: ${summary.nextSteps.join('；')}` : '',
    summary.analysis ? `分析: ${summary.analysis}` : '',
  ].filter(Boolean).join('\n')
}
