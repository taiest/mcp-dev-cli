import { execa, type ResultPromise } from 'execa'

export interface ClaudeOptions {
  prompt: string
  systemPrompt?: string
  appendSystemPrompt?: string
  model?: string
  outputFormat?: 'text' | 'json' | 'stream-json'
  allowedTools?: string
  disallowedTools?: string
  sessionId?: string
  resume?: string
  noSessionPersistence?: boolean
  cwd?: string
  bare?: boolean
  permissionMode?: 'acceptEdits' | 'auto' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan'
  dangerouslySkipPermissions?: boolean
}

export interface ClaudeAdapter {
  run(options: ClaudeOptions): Promise<string>
  spawn(options: ClaudeOptions): ResultPromise
  checkInstalled(): Promise<boolean>
}

export interface ClaudeRegisterMcpResult {
  added: boolean
  alreadyExists: boolean
  message: string
}

function buildArgs(options: ClaudeOptions): string[] {
  const args: string[] = ['-p', options.prompt]

  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt)
  }
  if (options.appendSystemPrompt) {
    args.push('--append-system-prompt', options.appendSystemPrompt)
  }
  if (options.model) {
    args.push('--model', options.model)
  }
  if (options.outputFormat) {
    args.push('--output-format', options.outputFormat)
    if (options.outputFormat === 'stream-json') {
      args.push('--verbose')
    }
  }
  if (options.allowedTools) {
    args.push('--allowed-tools', options.allowedTools)
  }
  if (options.disallowedTools) {
    args.push('--disallowed-tools', options.disallowedTools)
  }
  if (options.resume) {
    args.push('--resume', options.resume)
  }
  if (options.noSessionPersistence) {
    args.push('--no-session-persistence')
  }
  if (options.bare) {
    args.push('--bare')
  }
  if (options.permissionMode) {
    args.push('--permission-mode', options.permissionMode)
  }
  if (options.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }

  return args
}

export class ClaudeCliAdapter implements ClaudeAdapter {
  async run(options: ClaudeOptions): Promise<string> {
    const args = buildArgs(options)
    const result = await execa('claude', args, {
      cwd: options.cwd,
      reject: false,
      timeout: 600_000,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Claude CLI exited with code ${result.exitCode}: ${result.stderr}`)
    }
    return result.stdout
  }

  spawn(options: ClaudeOptions): ResultPromise {
    const args = buildArgs(options)
    return execa('claude', args, {
      cwd: options.cwd,
      reject: false,
      timeout: 1_800_000,
      input: undefined,
      stdin: 'ignore',
    })
  }

  async checkInstalled(): Promise<boolean> {
    try {
      const result = await execa('claude', ['--version'], { reject: false })
      return result.exitCode === 0
    } catch {
      return false
    }
  }
}

const defaultAdapter = new ClaudeCliAdapter()

export async function runClaude(options: ClaudeOptions): Promise<string> {
  return defaultAdapter.run(options)
}

export function spawnClaude(options: ClaudeOptions): ResultPromise {
  return defaultAdapter.spawn(options)
}

export async function checkClaudeInstalled(): Promise<boolean> {
  return defaultAdapter.checkInstalled()
}

export async function registerProjectMcpServer(projectRoot: string): Promise<ClaudeRegisterMcpResult> {
  const result = await execa('claude', ['mcp', 'add', 'mcp-dev-cli', '--scope', 'project', '--', 'npx', '-y', 'mcp-dev-cli'], {
    cwd: projectRoot,
    reject: false,
    timeout: 120_000,
  })

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
  if (result.exitCode === 0) {
    return {
      added: true,
      alreadyExists: false,
      message: output || 'mcp-dev-cli project MCP server added',
    }
  }

  if (/already exists/i.test(output)) {
    return {
      added: false,
      alreadyExists: true,
      message: output,
    }
  }

  throw new Error(output || `claude mcp add exited with code ${result.exitCode}`)
}
