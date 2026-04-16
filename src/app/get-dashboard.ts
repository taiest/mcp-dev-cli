import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'

export async function getDashboard(projectRoot: string): Promise<string> {
  const session = new SessionRuntime(projectRoot).load()
  if (!session) return '当前没有 active parallel session。'
  return JSON.stringify(buildDashboardView(session), null, 2)
}
