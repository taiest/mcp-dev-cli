import chalk from 'chalk'
import { choose, ask } from '../utils/prompt.js'
import { log } from '../utils/logger.js'
import { initCommand } from './init.js'
import { startCommand } from './start.js'
import { resumeCommand } from './resume.js'
import { rolesCommand } from './roles.js'
import { statusCommand } from './status.js'

export async function interactiveMenu(): Promise<void> {
  console.log()
  console.log(chalk.bold('🚀 MCP 协同开发工具 v0.1.0'))
  console.log(chalk.dim('━'.repeat(40)))

  while (true) {
    const idx = await choose('主菜单', [
      '🔧 初始化项目配置 (init)',
      '🎯 输入需求，启动协同开发 (start)',
      '🔄 断点续跑 (resume)',
      '👥 查看角色列表',
      '➕ 新增自定义角色',
      '🗑️  删除角色',
      '📊 查看任务状态',
      '👋 退出',
    ])

    try {
      switch (idx) {
        case 0:
          await initCommand()
          break
        case 1: {
          const req = await ask('请输入开发需求')
          if (req) await startCommand(req)
          break
        }
        case 2:
          await resumeCommand()
          break
        case 3:
          await rolesCommand()
          break
        case 4:
          await rolesCommand('add')
          break
        case 5:
          await rolesCommand('remove')
          break
        case 6:
          await statusCommand()
          break
        case 7:
          log.info('再见 👋')
          process.exit(0)
        default:
          log.warn('无效选择，请重试')
      }
    } catch (e) {
      log.error((e as Error).message)
    }
  }
}
