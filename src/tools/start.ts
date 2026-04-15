import { Orchestrator } from '../core/orchestrator.js'
import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { log } from '../utils/logger.js'
import { DEFAULT_CONFIG } from '../types.js'
import { initProject, isInitialized } from './init.js'

export async function startDev(requirement: string, projectRoot: string): Promise<string> {
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    return '❌ 未检测到 Claude Code CLI，请先安装: https://docs.anthropic.com/en/docs/claude-code'
  }

  // 自动 init
  if (!isInitialized(projectRoot)) {
    await initProject(projectRoot)
  }

  const config = {
    ...DEFAULT_CONFIG,
    projectRoot,
    autoConfirm: true,
  }

  const orchestrator = new Orchestrator(config)
  return orchestrator.start(requirement)
}
