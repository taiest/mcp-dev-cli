import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { renderExecutionPlan, renderSessionOutcome } from '../core/terminal/renderers.js'
import { parseWorkspaceMap, runForegroundExecution } from './foreground-execution.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

export async function resumeSession(projectRoot: string, server?: Server): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.resume()
  if (!session) {
    return [
      '🔁 Parallel Session Resumed',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '当前没有可恢复的 parallel session。',
      '',
      '建议下一步：',
      '- 先运行 parallel_startup，判断当前项目应该 resume 还是 start。',
      '- 如果你本来就是要开启新任务，直接运行 parallel_start。',
    ].join('\n')
  }

  if (session.phase === 'planning') {
    return renderExecutionPlan(buildDashboardView(session))
  }

  if (session.phase === 'completed') {
    return renderSessionOutcome({
      action: 'resumed',
      sessionId: session.sessionId,
      phase: session.phase,
      summary: [
        ['completed', session.taskGraph.tasks.filter(task => task.status === 'completed').length],
        ['failed', session.taskGraph.tasks.filter(task => task.status === 'failed').length],
        ['blocked', session.taskGraph.tasks.filter(task => task.status === 'blocked').length],
      ],
      sections: [
        {
          title: 'Resume State',
          lines: [
            '当前 session 已完成，无需再次恢复执行。',
            '如需查看最终结果，请直接使用 parallel_report；如需看当前快照，可使用 parallel_dashboard。',
          ],
        },
      ],
      nextStep: 'Use parallel_report to inspect the final summary.',
    })
  }

  const workspaceMap = parseWorkspaceMap(session.artifacts.workspaceMap)
  const execution = await runForegroundExecution({
    projectRoot,
    session,
    workspaces: workspaceMap,
    title: '🔁 Parallel Session Resumed',
    nextStep: finalSession => finalSession.phase === 'completed'
      ? 'Use parallel_report to review the final execution summary.'
      : 'Use parallel_dashboard to inspect blockers, workspace issues, and recovery suggestions.',
    contextAnalysis: 'parallel resume execution in progress',
    taskAction: 'resume-task-execution',
    mergeAction: 'resume-merge-session',
    mergeSuccessMessage: 'merge completed during resume',
    mergeFailureFallback: 'merge failed during resume',
    server,
  })

  return execution.output
}
