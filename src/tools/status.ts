import { CheckpointManager } from '../core/checkpoint.js'

export function getStatus(projectRoot: string): string {
  const cpManager = new CheckpointManager(projectRoot)
  const cp = cpManager.load()

  if (!cp || !cp.session_id) {
    return '当前没有进行中的协同开发任务。使用 mcp_dev_start 开始新任务。'
  }

  const lines: string[] = ['📊 任务状态', '━'.repeat(40)]
  lines.push(`  会话 ID    ${cp.session_id.slice(0, 8)}`)
  lines.push(`  状态       ${cp.status}`)
  lines.push(`  需求       ${cp.requirement.slice(0, 60)}`)
  lines.push(`  模型       ${cp.model}`)
  lines.push(`  基准分支   ${cp.base_branch}`)
  lines.push(`  更新时间   ${cp.updated_at}`)
  lines.push('')

  if (cp.tasks.length === 0) {
    lines.push('暂无子任务')
    return lines.join('\n')
  }

  const completed = cp.tasks.filter(t => t.status === 'completed').length
  const failed = cp.tasks.filter(t => t.status === 'failed').length
  const pending = cp.tasks.filter(t => t.status === 'pending').length
  const running = cp.tasks.filter(t => t.status === 'running').length

  lines.push(`进度: ${completed}/${cp.tasks.length} 完成 | ${failed} 失败 | ${running} 运行中 | ${pending} 待执行`)
  lines.push('')

  const icons: Record<string, string> = {
    completed: '✅', failed: '❌', running: '🔄', pending: '⏳',
  }

  for (const task of cp.tasks) {
    const icon = icons[task.status] || '❓'
    lines.push(`  ${icon} #${task.id} [${task.role}] ${task.title}`)
    if (task.error) {
      lines.push(`     ${task.error.slice(0, 80)}`)
    }
  }

  if (pending > 0 || running > 0) {
    lines.push('')
    lines.push('使用 mcp_dev_resume 继续执行')
  }

  return lines.join('\n')
}
