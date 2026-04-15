import { execa } from 'execa'
import type { MergeResult } from '../types.js'
import { BRANCH_PREFIX } from '../types.js'
import { log } from '../utils/logger.js'

export class GitManager {
  private cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
  }

  private async git(...args: string[]): Promise<string> {
    const result = await execa('git', args, { cwd: this.cwd, reject: false })
    if (result.exitCode !== 0 && !args.includes('merge')) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
    }
    return result.stdout.trim()
  }

  async currentBranch(): Promise<string> {
    return this.git('branch', '--show-current')
  }

  async createBranch(name: string, base?: string): Promise<void> {
    const fullName = name.startsWith(BRANCH_PREFIX) ? name : `${BRANCH_PREFIX}${name}`
    if (base) {
      await this.git('checkout', '-b', fullName, base)
    } else {
      await this.git('checkout', '-b', fullName)
    }
    log.git(`创建分支 ${fullName}`)
  }

  async checkout(branch: string): Promise<void> {
    await this.git('checkout', branch)
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.git('rev-parse', '--verify', name)
      return true
    } catch {
      return false
    }
  }

  async merge(source: string, target: string): Promise<MergeResult> {
    await this.checkout(target)
    const result = await execa('git', ['merge', '--no-ff', source, '-m', `merge: ${source} into ${target}`], {
      cwd: this.cwd,
      reject: false,
    })

    if (result.exitCode === 0) {
      log.git(`合并 ${source} → ${target} 成功`)
      return { success: true }
    }

    // 检查冲突文件
    const conflictResult = await execa('git', ['diff', '--name-only', '--diff-filter=U'], {
      cwd: this.cwd,
      reject: false,
    })
    const conflicts = conflictResult.stdout.trim().split('\n').filter(Boolean)

    if (conflicts.length > 0) {
      log.warn(`合并 ${source} → ${target} 有冲突: ${conflicts.join(', ')}`)
      return { success: false, conflicts }
    }

    return { success: false, error: result.stderr }
  }

  async abortMerge(): Promise<void> {
    await this.git('merge', '--abort')
  }

  async hasConflicts(source: string, target: string): Promise<boolean> {
    await this.checkout(target)
    const result = await execa('git', ['merge', '--no-commit', '--no-ff', source], {
      cwd: this.cwd,
      reject: false,
    })
    const hasConflict = result.exitCode !== 0
    // 无论如何都 abort
    await execa('git', ['merge', '--abort'], { cwd: this.cwd, reject: false })
    return hasConflict
  }

  async deleteBranch(name: string): Promise<void> {
    await this.git('branch', '-D', name)
    log.git(`删除分支 ${name}`)
  }

  async cleanupBranches(pattern?: string): Promise<void> {
    const prefix = pattern || `${BRANCH_PREFIX}*`
    const result = await this.git('branch', '--list', prefix)
    const branches = result.split('\n').map(b => b.trim().replace('* ', '')).filter(Boolean)
    for (const branch of branches) {
      await this.deleteBranch(branch)
    }
  }

  async stashIfDirty(): Promise<boolean> {
    const status = await this.git('status', '--porcelain')
    if (status) {
      await this.git('stash', 'push', '-m', 'mcp-dev-cli: auto stash before orchestration')
      return true
    }
    return false
  }

  async stashPop(): Promise<void> {
    await this.git('stash', 'pop')
  }

  async getChangedFiles(branch: string, base: string): Promise<string[]> {
    const result = await this.git('diff', '--name-only', base, branch)
    return result.split('\n').filter(Boolean)
  }
}
