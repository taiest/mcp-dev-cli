import chalk from 'chalk'
import { log } from '../utils/logger.js'
import { findProjectRoot } from '../utils/platform.js'
import { CheckpointManager } from '../core/checkpoint.js'

export async function statusCommand(): Promise<void> {
  const root = findProjectRoot()
  const cpManager = new CheckpointManager(root)
  const cp = cpManager.load()

  if (!cp || !cp.session_id) {
    log.info('当前没有进行中的协同开发任务')
    log.info('运行 `mcp-dev-cli start "需求"` 开始新任务')
    return
  }

  log.header('📊 任务状态')
  log.table([
    ['会话 ID', cp.session_id.slice(0, 8)],
    ['状态', cp.status],
    ['需求', cp.requirement.slice(0, 60)],
    ['模型', cp.model],
    ['基准分支', cp.base_branch],
    ['更新时间', cp.updated_at],
  ])
  log.blank()

  if (cp.tasks.length === 0) {
    log.info('暂无子任务')
    return
  }

  const completed = cp.tasks.filter(t => t.status === 'completed').length
  const failed = cp.tasks.filter(t => t.status === 'failed').length
  const pending = cp.tasks.filter(t => t.status === 'pending').length
  const running = cp.tasks.filter(t => t.status === 'running').length

  log.info(`进度: ${completed}/${cp.tasks.length} 完成 | ${failed} 失败 | ${running} 运行中 | ${pending} 待执行`)
  log.blank()

  for (const task of cp.tasks) {
    const icons: Record<string, string> = {
      completed: '✅',
      failed: '❌',
      running: '🔄',
      pending: '⏳',
    }
    const icon = icons[task.status] || '❓'
    console.log(`  ${icon} ${chalk.cyan(`#${task.id}`)} [${chalk.magenta(task.role)}] ${task.title}`)
    if (task.error) {
      console.log(`     ${chalk.red(task.error.slice(0, 80))}`)
    }
  }

  log.blank()
  if (pending > 0 || running > 0) {
    log.info('运行 `mcp-dev-cli resume` 继续执行')
  }
}
