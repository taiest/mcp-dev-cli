import type { PreflightCheckResult } from '../../../types.js'
import { checkClaudeInstalled } from '../../../utils/claude-cli.js'

export async function runClaudeCheck(): Promise<PreflightCheckResult> {
  const ok = await checkClaudeInstalled()
  return {
    name: 'claude',
    status: ok ? 'passed' : 'failed',
    message: ok ? 'Claude CLI 可用' : 'Claude CLI 不可用',
    autoFixable: false,
    category: 'environment',
    currentState: ok ? 'ready' : 'missing-cli',
    nextStep: ok ? undefined : '先安装并确保 claude 命令在 PATH 中可用。',
  }
}
