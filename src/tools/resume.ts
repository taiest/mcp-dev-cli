import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { resumeSession } from '../app/resume-session.js'

export async function resumeDev(projectRoot: string): Promise<string> {
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    return '❌ 未检测到 Claude Code CLI'
  }

  return resumeSession(projectRoot)
}
