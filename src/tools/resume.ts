import { CacheStore } from '../core/cache-store.js'
import { ContextStore } from '../core/context-store.js'
import { Orchestrator } from '../core/orchestrator.js'
import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { DEFAULT_CONFIG } from '../types.js'

export async function resumeDev(projectRoot: string): Promise<string> {
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    return '❌ 未检测到 Claude Code CLI'
  }

  const contextStore = new ContextStore(projectRoot)
  const cacheStore = new CacheStore(projectRoot)
  const contextSummary = contextStore.load()
  const restored = contextSummary
    ? { source: 'context', summaryText: contextStore.buildSummaryText(contextSummary) }
    : cacheStore.loadBestAvailable()

  const config = {
    ...DEFAULT_CONFIG,
    projectRoot,
    autoConfirm: true,
    contextSummaryText: restored?.summaryText || '',
  }

  const orchestrator = new Orchestrator(config)
  return orchestrator.resume()
}
