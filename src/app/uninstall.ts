import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PARALLEL_DIR } from '../types.js'

export async function uninstallProject(projectRoot: string): Promise<string> {
  const removed: string[] = []

  // Remove mcp-dev-cli from .mcp.json
  const mcpJsonPath = join(projectRoot, '.mcp.json')
  if (existsSync(mcpJsonPath)) {
    try {
      const config = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
      if (config?.mcpServers?.['mcp-dev-cli']) {
        delete config.mcpServers['mcp-dev-cli']
        if (Object.keys(config.mcpServers).length === 0) {
          rmSync(mcpJsonPath)
          removed.push('.mcp.json (deleted)')
        } else {
          writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n')
          removed.push('.mcp.json (mcp-dev-cli entry removed)')
        }
      }
    } catch {
      rmSync(mcpJsonPath)
      removed.push('.mcp.json (deleted)')
    }
  }

  // Remove .claude/parallel/
  const parallelDir = join(projectRoot, PARALLEL_DIR)
  if (existsSync(parallelDir)) {
    rmSync(parallelDir, { recursive: true })
    removed.push(PARALLEL_DIR)
  }

  if (removed.length === 0) {
    return [
      'ℹ️ mcp-dev-cli not installed',
      `project: ${projectRoot}`,
      'nothing to remove',
    ].join('\n')
  }

  return [
    '✅ mcp-dev-cli uninstall complete',
    `project: ${projectRoot}`,
    `removed: ${removed.join(', ')}`,
    '',
    '⚠️ 如果当前在 Claude Code 会话中，需要关闭并重新打开才能生效。',
  ].join('\n')
}
