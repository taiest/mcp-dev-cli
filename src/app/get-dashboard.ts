import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { renderDashboard } from '../core/terminal/renderers.js'

export async function getDashboard(projectRoot: string): Promise<string> {
  const session = new SessionRuntime(projectRoot).load()
  if (!session) {
    return [
      '📊 Parallel Dashboard',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '当前没有 active parallel session。',
      '',
      '建议下一步：',
      '- 先确认你已通过 /mcp 连接该工具。',
      '- 然后运行 parallel_startup，判断当前项目该 init、start 还是 resume。',
      '- 如果项目已 ready，直接在对话框输入需求并调用 parallel_start。',
    ].join('\n')
  }
  return renderDashboard(buildDashboardView(session))
}
