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

  // Clean settings.local.json
  const settingsPath = join(projectRoot, '.claude', 'settings.local.json')
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      let changed = false
      if (Array.isArray(settings.enabledMcpjsonServers)) {
        settings.enabledMcpjsonServers = settings.enabledMcpjsonServers.filter((s: string) => s !== 'mcp-dev-cli')
        if (settings.enabledMcpjsonServers.length === 0) delete settings.enabledMcpjsonServers
        changed = true
      }
      if (changed) {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
        removed.push('.claude/settings.local.json (cleaned)')
      }
    } catch { /* ignore */ }
  }

  // Clean CLAUDE.md — remove injected parallel workflow rules
  const claudeMdPath = join(projectRoot, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, 'utf-8')
    if (content.includes('MCP 多角色并行开发流程') || content.includes('MCP 协同开发规范')) {
      const cleaned = content
        .replace(/\n*## MCP 多角色并行开发流程（必须遵守）[\s\S]*?(?=\n## (?!MCP 协同)|$)/, '')
        .replace(/\n*## MCP 协同开发规范[\s\S]*?(?=\n## (?!角色|断点|接口|Git)|$)/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      if (cleaned.length < 20) {
        rmSync(claudeMdPath)
        removed.push('CLAUDE.md (deleted)')
      } else {
        writeFileSync(claudeMdPath, cleaned + '\n')
        removed.push('CLAUDE.md (mcp rules removed)')
      }
    }
  }

  // Remove .claude/parallel/
  const parallelDir = join(projectRoot, PARALLEL_DIR)
  if (existsSync(parallelDir)) {
    rmSync(parallelDir, { recursive: true })
    removed.push(PARALLEL_DIR)
  }

  // Remove .claude/agents/
  const agentsDir = join(projectRoot, '.claude', 'agents')
  if (existsSync(agentsDir)) {
    rmSync(agentsDir, { recursive: true })
    removed.push('.claude/agents')
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
