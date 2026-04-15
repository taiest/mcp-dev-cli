#!/usr/bin/env node

import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { startCommand } from './commands/start.js'
import { resumeCommand } from './commands/resume.js'
import { rolesCommand } from './commands/roles.js'
import { statusCommand } from './commands/status.js'
import { interactiveMenu } from './commands/menu.js'

const program = new Command()
  .name('mcp-dev-cli')
  .description('多 MCP 并行协同开发 CLI 工具')
  .version('0.1.0')

program
  .command('init')
  .description('初始化项目 MCP 协同配置')
  .action(initCommand)

program
  .command('start')
  .description('输入需求，启动协同开发')
  .argument('<requirement>', '开发需求描述')
  .action(startCommand)

program
  .command('resume')
  .description('断点续跑，恢复上次未完成的任务')
  .action(resumeCommand)

program
  .command('roles')
  .description('角色管理')
  .argument('[action]', '操作: add / remove (留空查看列表)')
  .action(rolesCommand)

program
  .command('status')
  .description('查看当前任务状态')
  .action(statusCommand)

// 无子命令时进入交互式菜单
if (process.argv.length <= 2) {
  interactiveMenu().catch(console.error)
} else {
  program.parse()
}
