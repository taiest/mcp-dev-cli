import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { renderExecutionPlan, renderSessionOutcome } from '../core/terminal/renderers.js'

export async function resumeSession(projectRoot: string): Promise<string> {
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

  // Reset stuck running tasks back to ready
  const tasks = session.taskGraph.tasks
  const stuckRunning = tasks.filter(t => t.status === 'running')
  if (stuckRunning.length > 0) {
    const updated = {
      ...session,
      taskGraph: {
        ...session.taskGraph,
        tasks: tasks.map(t => t.status === 'running' ? { ...t, status: 'ready' as const } : t),
      },
      mcps: session.mcps.map(m => m.status === 'running' ? { ...m, status: 'idle' as const } : m),
    }
    runtime.save(updated)
  }

  const completed = tasks.filter(t => t.status === 'completed').length
  const total = tasks.length
  return [
    '🔁 Parallel Session Resumed',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `Session: ${session.sessionId}`,
    `进度: ${completed}/${total} 任务已完成`,
    stuckRunning.length > 0 ? `已重置 ${stuckRunning.length} 个卡住的 running 任务为 ready` : '',
    '',
    '恢复完成。请立即调用 parallel_next_batch 获取可执行任务。',
  ].filter(Boolean).join('\n')
}
