import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PreflightCheckResult } from '../../../types.js'

export function runGitCheck(projectRoot: string): PreflightCheckResult {
  const gitDir = join(projectRoot, '.git')
  const hasGit = existsSync(gitDir)
  const lockExists = existsSync(join(gitDir, 'index.lock'))
  const mergeInProgress = existsSync(join(gitDir, 'MERGE_HEAD'))
  const rebaseInProgress = existsSync(join(gitDir, 'rebase-apply')) || existsSync(join(gitDir, 'rebase-merge'))
  const cherryPickInProgress = existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))
  if (!hasGit) {
    return {
      name: 'git',
      status: 'failed',
      message: '当前目录不是 Git 仓库',
      autoFixable: false,
      category: 'git',
      currentState: 'missing-repository',
      nextStep: '在 Git 仓库中运行工具，或先执行 git init / clone 项目。',
    }
  }
  if (lockExists) {
    return {
      name: 'git-lock',
      status: 'warning',
      message: '检测到 .git/index.lock',
      autoFixable: true,
      fixAction: 'inspect-or-clean-lock',
      category: 'git',
      currentState: 'lock-detected',
      nextStep: '确认没有其他 Git 进程占用后，再清理锁文件并重试。',
    }
  }
  if (mergeInProgress) {
    return {
      name: 'git-merge-state',
      status: 'warning',
      message: '检测到 merge 中间态',
      autoFixable: true,
      fixAction: 'abort-merge-or-resolve',
      category: 'git',
      currentState: 'merge-in-progress',
      nextStep: '先解决冲突或执行 git merge --abort，再重新启动 parallel session。',
    }
  }
  if (rebaseInProgress) {
    return {
      name: 'git-rebase-state',
      status: 'warning',
      message: '检测到 rebase 中间态',
      autoFixable: true,
      fixAction: 'abort-rebase-or-resolve',
      category: 'git',
      currentState: 'rebase-in-progress',
      nextStep: '先完成或执行 git rebase --abort，再重新启动 parallel session。',
    }
  }
  if (cherryPickInProgress) {
    return {
      name: 'git-cherry-pick-state',
      status: 'warning',
      message: '检测到 cherry-pick 中间态',
      autoFixable: true,
      fixAction: 'abort-cherry-pick-or-resolve',
      category: 'git',
      currentState: 'cherry-pick-in-progress',
      nextStep: '先完成或执行 git cherry-pick --abort，再重新启动 parallel session。',
    }
  }
  return {
    name: 'git',
    status: 'passed',
    message: 'Git 仓库健康',
    autoFixable: false,
    category: 'git',
    currentState: 'ready',
  }
}
