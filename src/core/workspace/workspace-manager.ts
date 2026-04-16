import type { ExecutionSession, WorkspaceDescriptor } from '../../types.js'
import { GitWorktreeManager } from './git-worktree-manager.js'
import { WorkspaceLock } from './workspace-lock.js'
import type { GitRepositoryState } from '../git/git-runtime.js'

export class WorkspaceManager {
  private worktree: GitWorktreeManager
  private lock = new WorkspaceLock()

  constructor(private projectRoot: string) {
    this.worktree = new GitWorktreeManager(projectRoot)
  }

  async prepare(session: ExecutionSession): Promise<Record<string, WorkspaceDescriptor>> {
    const result: Record<string, WorkspaceDescriptor> = {}
    for (const mcp of session.mcps) {
      const branch = `parallel/${mcp.id.toLowerCase()}`
      const descriptor = await this.worktree.create(mcp.id, branch, session.baseBranch)
      this.lock.acquire(descriptor.id)
      result[mcp.id] = descriptor
    }
    return result
  }

  async commitOutputs(workspaces: Record<string, WorkspaceDescriptor>): Promise<string[]> {
    const committed: string[] = []
    for (const workspace of Object.values(workspaces)) {
      const ok = await this.worktree.commitIfNeeded(workspace, `parallel: commit ${workspace.mcpId}`)
      if (ok) committed.push(workspace.branch)
    }
    return committed
  }

  async mergeByController(
    workspaces: Record<string, WorkspaceDescriptor>,
    controllerWorkspace: WorkspaceDescriptor,
    baseBranch: string,
    branchOrder: string[]
  ): Promise<{ merged: string[]; failed: Array<{ branch: string; error?: string }> }> {
    const merged: string[] = []
    const failed: Array<{ branch: string; error?: string }> = []

    await this.worktree.checkoutBranch(controllerWorkspace, baseBranch)

    for (const branch of branchOrder) {
      if (branch === controllerWorkspace.branch) continue
      const result = await this.worktree.mergeBranchIntoCurrent(controllerWorkspace, branch)
      if (result.success) {
        merged.push(branch)
      } else {
        failed.push({ branch, error: result.error })
        break
      }
    }

    return { merged, failed }
  }

  async inspectWorkspace(workspace: WorkspaceDescriptor): Promise<GitRepositoryState> {
    return this.worktree.readRepositoryState(workspace)
  }

  async clearWorkspaceState(workspace: WorkspaceDescriptor): Promise<string[]> {
    return this.worktree.clearRepositoryState(workspace)
  }

  async rollbackWorkspaceTask(workspace: WorkspaceDescriptor): Promise<string[]> {
    return this.worktree.clearRepositoryState(workspace)
  }

  async abortMerges(controllerWorkspace: WorkspaceDescriptor): Promise<void> {
    await this.worktree.abortMerge(controllerWorkspace)
  }
}
