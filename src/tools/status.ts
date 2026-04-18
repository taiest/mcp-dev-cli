import { SessionRuntime } from '../core/runtime/session-runtime.js'

export function getStatus(projectRoot: string): string {
  const session = new SessionRuntime(projectRoot).load()

  if (!session) {
    return [
      '📊 Parallel session 状态',
      '━'.repeat(40),
      '当前没有进行中的 parallel session。',
      '',
      '建议下一步：',
      '- 先运行 parallel_startup，判断当前项目应该 start 还是 resume。',
      '- 如果你已经确认项目环境就绪，也可以直接运行 parallel_start 开始新任务。',
    ].join('\n')
  }

  const completed = session.taskGraph.tasks.filter(task => task.status === 'completed').length
  const failed = session.taskGraph.tasks.filter(task => task.status === 'failed').length
  const pending = session.taskGraph.tasks.filter(task => task.status === 'pending' || task.status === 'blocked' || task.status === 'ready').length
  const running = session.taskGraph.tasks.filter(task => task.status === 'running').length

  const lines: string[] = ['📊 Parallel session 状态', '━'.repeat(40)]
  lines.push(`  会话 ID    ${session.sessionId}`)
  lines.push(`  阶段       ${session.phase}`)
  lines.push(`  需求       ${session.requirement.slice(0, 60)}`)
  lines.push(`  基准分支   ${session.baseBranch}`)
  lines.push(`  更新时间   ${session.updatedAt}`)
  lines.push('')
  lines.push(`进度: ${completed}/${session.taskGraph.tasks.length} 完成 | ${failed} 失败 | ${running} 运行中 | ${pending} 待恢复`)
  lines.push('')

  for (const task of session.taskGraph.tasks) {
    const icon = task.status === 'completed'
      ? '✅'
      : task.status === 'failed'
        ? '❌'
        : task.status === 'running'
          ? '🔄'
          : '⏳'
    lines.push(`  ${icon} #${task.id} [${task.roleType}] ${task.title}`)
  }

  if (session.phase !== 'completed') {
    lines.push('')
    lines.push('建议下一步：使用 parallel_dashboard 查看当前进度，或使用 parallel_resume 继续执行。')
  }

  return lines.join('\n')
}
