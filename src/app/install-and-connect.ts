import { initProjectApp } from './init-project.js'
import { checkClaudeInstalled, registerProjectMcpServer } from '../utils/claude-cli.js'
import { inspectProjectMcpConfig, normalizeProjectMcpConfig } from '../utils/mcp-config.js'

export async function installAndConnect(projectRoot: string): Promise<string> {
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    return [
      '❌ mcp-dev-cli install failed',
      `project: ${projectRoot}`,
      'claude: missing',
      'next: install Claude Code CLI first, then rerun `npx -y mcp-dev-cli install`',
    ].join('\n')
  }

  const before = inspectProjectMcpConfig(projectRoot)
  const registerResult = await registerProjectMcpServer(projectRoot)
  const normalized = normalizeProjectMcpConfig(projectRoot)
  const initResult = await initProjectApp(projectRoot)
  const after = inspectProjectMcpConfig(projectRoot)

  return [
    '✅ mcp-dev-cli install complete',
    `project: ${projectRoot}`,
    `claude: ${hasClaude ? 'available' : 'missing'}`,
    `mcp registration: ${registerResult.added ? 'added' : registerResult.alreadyExists ? 'already-present' : 'unknown'}`,
    `mcp config: ${after.valid ? 'ready' : 'invalid'}`,
    `config file: ${after.path}`,
    `config normalized: ${normalized.updated || !before.valid ? 'yes' : 'no'}`,
    `legacy filesystem removed: ${normalized.removedLegacyFilesystemServer ? 'yes' : 'no'}`,
    '',
    initResult,
    '',
    'next steps:',
    '1. open Claude Code in this project',
    '2. run /mcp',
    '3. select mcp-dev-cli',
    '4. run parallel_startup',
  ].join('\n')
}
