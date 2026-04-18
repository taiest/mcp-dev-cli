import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { startParallelSession } from '../app/start-parallel-session.js'
import { initProjectApp } from '../app/init-project.js'

export async function startDev(requirement: string, projectRoot: string): Promise<string> {
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    return '❌ 未检测到 Claude Code CLI，请先安装: https://docs.anthropic.com/en/docs/claude-code'
  }

  await initProjectApp(projectRoot)
  return [
    '已完成必要初始化，开始分配任务、创建角色并启动多 MCP 开发流程。',
    '',
    await startParallelSession(requirement, projectRoot),
  ].join('\n')
}
