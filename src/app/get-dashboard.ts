import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { renderDashboard } from '../core/terminal/renderers.js'

export async function getDashboard(projectRoot: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) {
    const startup = await runtime.buildStartupFlow()
    return [
      '📊 Parallel Dashboard',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '当前没有 active parallel session。',
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
  return renderDashboard(buildDashboardView(session))
}
