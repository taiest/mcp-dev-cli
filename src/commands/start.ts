import { Orchestrator } from '../core/orchestrator.js'
import { findProjectRoot } from '../utils/platform.js'
import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { log } from '../utils/logger.js'
import { DEFAULT_CONFIG } from '../types.js'

export async function startCommand(requirement: string): Promise<void> {
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    log.error('未检测到 Claude Code CLI')
    return
  }

  const config = {
    ...DEFAULT_CONFIG,
    projectRoot: findProjectRoot(),
  }

  const orchestrator = new Orchestrator(config)
  await orchestrator.start(requirement)
}
