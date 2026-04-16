import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { execa } from 'execa'

export type GitRepositoryState = {
  gitDir: string
  lockExists: boolean
  mergeInProgress: boolean
  rebaseInProgress: boolean
  cherryPickInProgress: boolean
}

export class GitRuntime {
  constructor(private projectRoot: string) {}

  async run(args: string[], cwd = this.projectRoot): Promise<string> {
    const result = await execa('git', args, { cwd, reject: false })
    if (result.exitCode !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
    return result.stdout.trim()
  }

  async currentBranch(): Promise<string> {
    return this.run(['branch', '--show-current'])
  }

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.run(['rev-parse', '--verify', name])
      return true
    } catch {
      return false
    }
  }

  async gitDir(cwd = this.projectRoot): Promise<string> {
    const gitDir = await this.run(['rev-parse', '--git-dir'], cwd)
    return isAbsolute(gitDir) ? gitDir : join(cwd, gitDir)
  }

  async detectRepositoryState(cwd = this.projectRoot): Promise<GitRepositoryState> {
    const gitDir = await this.gitDir(cwd)
    return {
      gitDir,
      lockExists: existsSync(join(gitDir, 'index.lock')),
      mergeInProgress: existsSync(join(gitDir, 'MERGE_HEAD')),
      rebaseInProgress: existsSync(join(gitDir, 'rebase-apply')) || existsSync(join(gitDir, 'rebase-merge')),
      cherryPickInProgress: existsSync(join(gitDir, 'CHERRY_PICK_HEAD')),
    }
  }

  async abortInProgress(cwd = this.projectRoot): Promise<string[]> {
    const state = await this.detectRepositoryState(cwd)
    const aborted: string[] = []

    if (state.mergeInProgress) {
      await execa('git', ['merge', '--abort'], { cwd, reject: false })
      aborted.push('merge')
    }

    if (state.rebaseInProgress) {
      await execa('git', ['rebase', '--abort'], { cwd, reject: false })
      aborted.push('rebase')
    }

    if (state.cherryPickInProgress) {
      await execa('git', ['cherry-pick', '--abort'], { cwd, reject: false })
      aborted.push('cherry-pick')
    }

    return aborted
  }

  async hasDiff(cwd = this.projectRoot): Promise<boolean> {
    const output = await this.run(['status', '--short'], cwd)
    return output.trim().length > 0
  }

  async addAll(cwd = this.projectRoot): Promise<void> {
    await this.run(['add', '-A'], cwd)
  }

  async commit(message: string, cwd = this.projectRoot): Promise<boolean> {
    const result = await execa('git', ['commit', '-m', message], { cwd, reject: false })
    return result.exitCode === 0
  }

  async merge(branch: string, cwd = this.projectRoot): Promise<{ success: boolean; error?: string }> {
    const result = await execa('git', ['merge', '--no-ff', branch], { cwd, reject: false })
    return result.exitCode === 0
      ? { success: true }
      : { success: false, error: result.stderr || result.stdout || `merge ${branch} failed` }
  }

  async abortMerge(cwd = this.projectRoot): Promise<void> {
    await execa('git', ['merge', '--abort'], { cwd, reject: false })
  }
}
