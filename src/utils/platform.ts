import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { LOCAL_CACHE_ROOT_NAME, PARALLEL_DIR } from '../types.js'

export function normalizePath(p: string): string {
  return p.split(sep).join('/')
}

export function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function looksLikeProjectRoot(path: string): boolean {
  return existsSync(join(path, '.git'))
    || existsSync(join(path, 'package.json'))
    || existsSync(join(path, 'go.mod'))
    || existsSync(join(path, 'pyproject.toml'))
    || existsSync(join(path, 'requirements.txt'))
    || existsSync(join(path, 'Cargo.toml'))
    || existsSync(join(path, 'CLAUDE.md'))
}

export function findProjectRoot(startDir?: string): string {
  const envRoot = process.env.MCP_PROJECT_ROOT
  if (envRoot && existsSync(join(envRoot, '.git'))) return envRoot
  let dir = resolve(startDir || process.cwd())
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, '.git'))) return dir
    dir = resolve(dir, '..')
  }
  return envRoot || process.cwd()
}

function findClaudeWorkspaceHost(startDir?: string): string | null {
  const normalized = normalizePath(resolve(startDir || process.cwd()))
  const marker = '/.claude/worktrees/'
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex === -1) return null
  return normalized.slice(0, markerIndex)
}

export function resolveInstallProjectRoot(explicitPath?: string, startDir?: string): string {
  if (explicitPath) return resolve(explicitPath)
  return findClaudeWorkspaceHost(startDir) || findProjectRoot(startDir)
}

export function findInstallProjectRoot(startDir?: string): string {
  return resolveInstallProjectRoot(undefined, startDir)
}

export function listClaudeWorktreeRoots(projectRoot: string): string[] {
  const worktreesDir = join(projectRoot, '.claude', 'worktrees')
  if (!existsSync(worktreesDir)) return []

  try {
    return readdirSync(worktreesDir)
      .map(name => join(worktreesDir, name))
      .filter(path => {
        try {
          return statSync(path).isDirectory() && existsSync(join(path, '.git'))
        } catch {
          return false
        }
      })
  } catch {
    return []
  }
}

export function resolveMcpInstallTargets(startDir?: string, explicitPath?: string): string[] {
  const projectRoot = resolveInstallProjectRoot(explicitPath, startDir)
  const currentWorkspaceRoot = explicitPath ? projectRoot : findProjectRoot(startDir)
  const targets: string[] = []

  if (!targets.includes(currentWorkspaceRoot)) {
    targets.push(currentWorkspaceRoot)
  }

  if (!targets.includes(projectRoot)) {
    targets.push(projectRoot)
  }

  for (const worktreeRoot of listClaudeWorktreeRoots(projectRoot)) {
    if (!targets.includes(worktreeRoot)) targets.push(worktreeRoot)
  }

  return targets
}

export function hasFile(root: string, ...paths: string[]): boolean {
  return existsSync(join(root, ...paths))
}

export interface TechStack {
  hasGo: boolean
  hasNode: boolean
  hasPython: boolean
  hasRust: boolean
  frameworks: string[]
}

export function detectTechStack(root: string): TechStack {
  const stack: TechStack = {
    hasGo: false,
    hasNode: false,
    hasPython: false,
    hasRust: false,
    frameworks: [],
  }

  if (hasFile(root, 'go.mod')) {
    stack.hasGo = true
    stack.frameworks.push('Go')
  }
  if (hasFile(root, 'package.json') || hasFile(root, 'pnpm-workspace.yaml')) {
    stack.hasNode = true
    stack.frameworks.push('Node.js')
  }
  if (hasFile(root, 'requirements.txt') || hasFile(root, 'pyproject.toml')) {
    stack.hasPython = true
    stack.frameworks.push('Python')
  }
  if (hasFile(root, 'Cargo.toml')) {
    stack.hasRust = true
    stack.frameworks.push('Rust')
  }

  if (hasFile(root, 'server/go.mod')) {
    if (!stack.hasGo) stack.hasGo = true
    stack.frameworks.push('Go (server/)')
  }
  if (hasFile(root, 'miniapp/package.json')) {
    if (!stack.hasNode) stack.hasNode = true
    stack.frameworks.push('Taro (miniapp/)')
  }

  return stack
}

export function getBuildCommands(root: string): string[] {
  const cmds: string[] = []
  if (hasFile(root, 'go.mod')) cmds.push('go build ./...')
  if (hasFile(root, 'server/go.mod')) cmds.push('cd server && go build ./...')
  if (hasFile(root, 'tsconfig.json')) cmds.push('npx tsc --noEmit')
  if (hasFile(root, 'server/web/merchant-admin/tsconfig.json')) {
    cmds.push('cd server/web/merchant-admin && npx tsc --noEmit')
  }
  return cmds
}

export function getQualityCommands(root: string): { test: string[]; lint: string[]; security: string[] } {
  const pkg = readPackageJson(root)
  const test: string[] = []
  const lint: string[] = []
  const security: string[] = []

  if (pkg?.scripts?.test) {
    test.push('npm run test')
  } else if (hasFile(root, 'go.mod')) {
    test.push('go test ./...')
  }

  if (pkg?.scripts?.lint) {
    lint.push('npm run lint')
  } else if (hasFile(root, 'tsconfig.json')) {
    lint.push('npx tsc --noEmit')
  }

  if (pkg) {
    security.push('npm audit --audit-level=high')
  }

  return { test, lint, security }
}

function readPackageJson(root: string): { scripts?: Record<string, string> } | null {
  const file = join(root, 'package.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as { scripts?: Record<string, string> }
  } catch {
    return null
  }
}

export function getProjectHash(projectRoot: string): string {
  return createHash('sha1').update(normalizePath(resolve(projectRoot))).digest('hex')
}

export function getLocalCacheRoot(): string {
  return join(homedir(), LOCAL_CACHE_ROOT_NAME)
}

export function getLocalProjectCacheDir(projectRoot: string): string {
  return join(getLocalCacheRoot(), getProjectHash(projectRoot))
}

export function getGitInfo(projectRoot: string): { branch: string; head: string } {
  return {
    branch: getGitValue(projectRoot, ['branch', '--show-current']),
    head: getGitValue(projectRoot, ['rev-parse', 'HEAD']),
  }
}

export function hasParallelPlatform(root: string): boolean {
  return existsSync(join(root, PARALLEL_DIR))
}

export function hasClaudeMd(root: string): boolean {
  return existsSync(join(root, 'CLAUDE.md'))
}

export function hasMcpConfig(root: string): boolean {
  return existsSync(join(root, '.mcp.json'))
}

function getGitValue(projectRoot: string, args: string[]): string {
  try {
    const child = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf-8' })
    if (child.status !== 0) return ''
    return (child.stdout || '').trim()
  } catch {
    return ''
  }
}
