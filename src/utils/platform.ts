import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { LOCAL_CACHE_ROOT_NAME } from '../types.js'

export function isWindows(): boolean {
  return platform() === 'win32'
}

export function isMac(): boolean {
  return platform() === 'darwin'
}

export function normalizePath(p: string): string {
  return p.split(sep).join('/')
}

export function findProjectRoot(startDir?: string): string {
  let dir = resolve(startDir || process.cwd())
  while (dir !== resolve(dir, '..')) {
    if (existsSync(join(dir, '.git'))) return dir
    dir = resolve(dir, '..')
  }
  return process.cwd()
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

  if (hasFile(root, 'server/go.mod')) stack.frameworks.push('Go (server/)')
  if (hasFile(root, 'miniapp/package.json')) stack.frameworks.push('Taro (miniapp/)')

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

function getGitValue(projectRoot: string, args: string[]): string {
  try {
    const child = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf-8' })
    if (child.status !== 0) return ''
    return (child.stdout || '').trim()
  } catch {
    return ''
  }
}
