import { Orchestrator } from '../core/orchestrator.js'
import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { DEFAULT_CONFIG } from '../types.js'

export async function resumeDev(projectRoot: string): Promise<string> {
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    return '❌ 未检测到 Claude Code CLI'
  }

  const config = {
    ...DEFAULT_CONFIG,
    projectRoot,
    autoConfirm: true,
  }

  const orchestrator = new Orchestrator(config)
  return orchestrator.resume()
}
