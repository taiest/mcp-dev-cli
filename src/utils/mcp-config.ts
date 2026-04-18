import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MCP_DEV_CLI_SERVER_NAME = 'mcp-dev-cli'

export interface McpConfigInspection {
  exists: boolean
  valid: boolean
  parseError: boolean
  hasServer: boolean
  hasLegacyFilesystemServer: boolean
  path: string
}

export interface NormalizeMcpConfigResult {
  updated: boolean
  created: boolean
  alreadyValid: boolean
  removedLegacyFilesystemServer: boolean
  path: string
}

function configPath(projectRoot: string): string {
  return join(projectRoot, '.mcp.json')
}

function expectedServerConfig(): Record<string, unknown> {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-dev-cli'],
    env: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExpectedArgs(value: unknown): boolean {
  return Array.isArray(value)
    && value.length >= 2
    && value[0] === '-y'
    && value[1] === 'mcp-dev-cli'
}

function isExpectedServerConfig(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.command !== 'npx') return false
  if (!hasExpectedArgs(value.args)) return false
  if ('type' in value && value.type !== 'stdio') return false
  if ('env' in value && !isRecord(value.env)) return false
  return true
}

function isLegacyFilesystemServer(value: unknown): boolean {
  if (!isRecord(value)) return false
  const args = value.args
  return value.command === 'npx'
    && Array.isArray(args)
    && args.length >= 2
    && args[0] === '-y'
    && args[1] === '@anthropic/mcp-filesystem'
}

function readParsedConfig(projectRoot: string): { exists: boolean; parseError: boolean; data: Record<string, unknown> | null } {
  const filePath = configPath(projectRoot)
  if (!existsSync(filePath)) {
    return { exists: false, parseError: false, data: null }
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    return {
      exists: true,
      parseError: !isRecord(parsed),
      data: isRecord(parsed) ? parsed : null,
    }
  } catch {
    return { exists: true, parseError: true, data: null }
  }
}

export function inspectProjectMcpConfig(projectRoot: string): McpConfigInspection {
  const path = configPath(projectRoot)
  const parsed = readParsedConfig(projectRoot)
  if (!parsed.exists) {
    return {
      exists: false,
      valid: false,
      parseError: false,
      hasServer: false,
      hasLegacyFilesystemServer: false,
      path,
    }
  }

  if (parsed.parseError || !parsed.data) {
    return {
      exists: true,
      valid: false,
      parseError: true,
      hasServer: false,
      hasLegacyFilesystemServer: false,
      path,
    }
  }

  const servers = isRecord(parsed.data.mcpServers) ? parsed.data.mcpServers : null
  const target = servers ? servers[MCP_DEV_CLI_SERVER_NAME] : undefined
  const legacyFilesystem = servers ? isLegacyFilesystemServer(servers.filesystem) : false

  return {
    exists: true,
    valid: isExpectedServerConfig(target),
    parseError: false,
    hasServer: typeof target !== 'undefined',
    hasLegacyFilesystemServer: legacyFilesystem,
    path,
  }
}

export function normalizeProjectMcpConfig(projectRoot: string): NormalizeMcpConfigResult {
  const path = configPath(projectRoot)
  const parsed = readParsedConfig(projectRoot)
  const base = parsed.data && !parsed.parseError ? { ...parsed.data } : {}
  const servers = isRecord(base.mcpServers) ? { ...base.mcpServers } : {}
  const alreadyValid = isExpectedServerConfig(servers[MCP_DEV_CLI_SERVER_NAME])
  const removedLegacyFilesystemServer = isLegacyFilesystemServer(servers.filesystem)

  if (removedLegacyFilesystemServer) {
    delete servers.filesystem
  }

  if (!alreadyValid) {
    servers[MCP_DEV_CLI_SERVER_NAME] = expectedServerConfig()
  }

  const updated = !parsed.exists || parsed.parseError || !alreadyValid || removedLegacyFilesystemServer || !isRecord(base.mcpServers)
  if (updated) {
    writeFileSync(path, JSON.stringify({ ...base, mcpServers: servers }, null, 2) + '\n', 'utf-8')
  }

  return {
    updated,
    created: !parsed.exists,
    alreadyValid,
    removedLegacyFilesystemServer,
    path,
  }
}
