import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { WorkspaceDescriptor } from '../../types.js'
import { PARALLEL_WORKSPACES_DIR } from '../../types.js'
import { GitRuntime, type GitRepositoryState } from '../git/git-runtime.js'

export class GitWorktreeManager {
  private git: GitRuntime

  constructor(private projectRoot: string) {
    this.git = new GitRuntime(projectRoot)
  }

  async create(mcpId: string, branch: string, baseBranch: string): Promise<WorkspaceDescriptor> {
    const id = `${mcpId.toLowerCase()}-${branch.replace(/[^a-zA-Z0-9-]/g, '-')}`
    const path = join(this.projectRoot, PARALLEL_WORKSPACES_DIR, id)
    mkdirSync(join(this.projectRoot, PARALLEL_WORKSPACES_DIR), { recursive: true })

    if (!existsSync(path)) {
      const exists = await this.git.branchExists(branch)
      if (exists) {
        await this.git.run(['worktree', 'add', path, branch])
      } else {
        await this.git.run(['worktree', 'add', '-b', branch, path, baseBranch])
      }
    }

    return { id, mcpId, branch, path }
  }

  async commitIfNeeded(workspace: WorkspaceDescriptor, message: string): Promise<boolean> {
    const hasDiff = await this.git.hasDiff(workspace.path)
    if (!hasDiff) return false
    await this.git.addAll(workspace.path)
    return this.git.commit(message, workspace.path)
  }

  async checkoutBranch(workspace: WorkspaceDescriptor, branch: string): Promise<void> {
    await this.git.run(['checkout', branch], workspace.path)
  }

  async mergeBranchIntoCurrent(workspace: WorkspaceDescriptor, branch: string): Promise<{ success: boolean; error?: string }> {
    return this.git.merge(branch, workspace.path)
  }

  async readRepositoryState(workspace: WorkspaceDescriptor): Promise<GitRepositoryState> {
    return this.git.detectRepositoryState(workspace.path)
  }

  async clearRepositoryState(workspace: WorkspaceDescriptor): Promise<string[]> {
    return this.git.abortInProgress(workspace.path)
  }

  async abortMerge(workspace: WorkspaceDescriptor): Promise<void> {
    await this.git.abortMerge(workspace.path)
  }
}
