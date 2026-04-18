import { existsSync } from 'node:fs'
import { initProjectApp } from './init-project.js'
import { checkClaudeInstalled, registerProjectMcpServer } from '../utils/claude-cli.js'
import { inspectProjectMcpConfig, normalizeProjectMcpConfig } from '../utils/mcp-config.js'
import { isDirectoryPath, looksLikeProjectRoot, resolveInstallProjectRoot, resolveMcpInstallTargets } from '../utils/platform.js'

export async function installAndConnect(projectRootInput: string): Promise<string> {
  const projectRoot = resolveInstallProjectRoot(projectRootInput)

  if (!existsSync(projectRoot)) {
    return [
      '❌ mcp-dev-cli install failed',
      `project: ${projectRoot}`,
      'path: missing',
      'next: pass a real local project path, then rerun `npx -y mcp-dev-cli install "/absolute/project/path"`',
    ].join('\n')
  }

  if (!isDirectoryPath(projectRoot)) {
    return [
      '❌ mcp-dev-cli install failed',
      `project: ${projectRoot}`,
      'path: not-a-directory',
      'next: pass a project directory path, then rerun `npx -y mcp-dev-cli install "/absolute/project/path"`',
    ].join('\n')
  }

  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    return [
      '❌ mcp-dev-cli install failed',
      `project: ${projectRoot}`,
      'claude: missing',
      'next: install Claude Code CLI first, then rerun `npx -y mcp-dev-cli install "/absolute/project/path"`',
    ].join('\n')
  }

  const targets = resolveMcpInstallTargets(undefined, projectRoot)
  const before = inspectProjectMcpConfig(projectRoot)
  const registerResult = await registerProjectMcpServer(projectRoot)
  const normalizedTargets = targets.map(target => {
    const normalized = normalizeProjectMcpConfig(target)
    const after = inspectProjectMcpConfig(target)
    return { target, normalized, after }
  })
  const initResult = await initProjectApp(projectRoot)
  const after = inspectProjectMcpConfig(projectRoot)
  const projectShape = looksLikeProjectRoot(projectRoot) ? 'recognized' : 'unknown'

  return [
    '✅ mcp-dev-cli install complete',
    `project: ${projectRoot}`,
    `path: ok`,
    `project shape: ${projectShape}`,
    `claude: ${hasClaude ? 'available' : 'missing'}`,
    `mcp registration: ${registerResult.added ? 'added' : registerResult.alreadyExists ? 'already-present' : 'unknown'}`,
    `mcp config: ${after.valid ? 'ready' : 'invalid'}`,
    `config file: ${after.path}`,
    `config normalized: ${normalizedTargets.some(item => item.normalized.updated) || !before.valid ? 'yes' : 'no'}`,
    `legacy filesystem removed: ${normalizedTargets.some(item => item.normalized.removedLegacyFilesystemServer) ? 'yes' : 'no'}`,
    `install targets: ${targets.length}`,
    ...normalizedTargets.map(item => `- ${item.target}: ${item.after.valid ? 'ready' : 'invalid'}`),
    '',
    initResult,
    '',
    '⚠️ 重要：如果你是在 Claude Code 会话中执行的安装，必须先关闭当前会话，再重新打开项目目录。',
    '   Claude Code 不会自动加载新的 .mcp.json 配置，重启后才能识别 mcp-dev-cli。',
    '',
    'next steps:',
    '1. 关闭当前 Claude Code 会话（输入 /exit 或关闭终端）',
    '2. 在项目目录重新打开 Claude Code',
    '3. 输入 /mcp，选择 mcp-dev-cli 并信任连接',
    '4. 使用 parallel_startup 查看项目状态',
    '5. 使用 parallel_requirement 输入需求，或直接使用 parallel_start 开始规划',
    '',
    '卸载命令: npx -y mcp-dev-cli uninstall "/absolute/project/path"',
  ].join('\n')
}
