import type { ExecutionSession, MergeResult, WorkspaceDescriptor } from '../../types.js'
import { WorkspaceManager } from '../workspace/workspace-manager.js'
import { PolicyEngine } from '../policy/policy-engine.js'

function buildMergeOrder(session: ExecutionSession, workspaces: Record<string, WorkspaceDescriptor>): string[] {
  const taskOrder = [...session.taskGraph.tasks].sort((a, b) => a.priority - b.priority)
  const orderedBranches = taskOrder
    .map(task => task.assignedMcpId ? workspaces[task.assignedMcpId]?.branch : undefined)
    .filter((branch): branch is string => Boolean(branch))

  return Array.from(new Set(orderedBranches))
}

function formatWorkspaceState(conflicts: string[]): string {
  return conflicts.join(', ') || 'repository state blocked merge'
}

function governanceMergeFailure(session: ExecutionSession): MergeResult {
  const governanceStatus = session.governance?.status || 'pending'
  const reviewTaskIds = session.governance?.reviewRequiredTaskIds || []

  if (governanceStatus === 'review_rejected') {
    return {
      success: false,
      conflicts: reviewTaskIds,
      error: 'governance gate prevents merge: review rejected',
      mergeOrder: [],
      mergedBranches: [],
      failedBranches: reviewTaskIds.map(taskId => ({ branch: taskId, error: 'review rejected' })),
    }
  }

  if (governanceStatus === 'waiting_approval' || governanceStatus === 'review_assigned' || governanceStatus === 'review_required') {
    return {
      success: false,
      conflicts: reviewTaskIds,
      error: 'governance gate prevents merge: review approvals not complete',
      mergeOrder: [],
      mergedBranches: [],
      failedBranches: reviewTaskIds.map(taskId => ({ branch: taskId, error: 'review approval pending' })),
    }
  }

  return {
    success: false,
    conflicts: reviewTaskIds,
    error: `governance gate prevents merge: ${governanceStatus}`,
    mergeOrder: [],
    mergedBranches: [],
    failedBranches: reviewTaskIds.map(taskId => ({ branch: taskId, error: governanceStatus })),
  }
}

export class GitMergeService {
  constructor(private projectRoot: string) {}

  async merge(session: ExecutionSession, workspaces: Record<string, WorkspaceDescriptor>): Promise<MergeResult> {
    const blocked = session.taskGraph.tasks.filter(task => task.status === 'blocked')
    const failed = session.taskGraph.tasks.filter(task => task.status === 'failed')

    if (blocked.length > 0) {
      return {
        success: false,
        conflicts: blocked.map(task => task.id),
        error: `blocked tasks prevent merge: ${blocked.map(task => task.id).join(', ')}`,
        mergeOrder: [],
        mergedBranches: [],
        failedBranches: blocked.map(task => ({ branch: task.id, error: 'task blocked' })),
      }
    }

    if (failed.length > 0) {
      return {
        success: false,
        conflicts: failed.map(task => task.id),
        error: `failed tasks prevent merge: ${failed.map(task => task.id).join(', ')}`,
        mergeOrder: [],
        mergedBranches: [],
        failedBranches: failed.map(task => ({ branch: task.id, error: 'task failed' })),
      }
    }

    const reviewRequiredTaskIds = session.governance?.reviewRequiredTaskIds || []
    if (reviewRequiredTaskIds.length === 0) {
      return {
        success: true,
        conflicts: [],
        error: undefined,
        mergeOrder: [],
        mergedBranches: [],
        failedBranches: [],
      }
    }

    if (!session.governance?.readyForMerge) {
      return governanceMergeFailure(session)
    }

    const workspaceManager = new WorkspaceManager(this.projectRoot)
    const controllerWorkspace = workspaces[session.controllerMcpId]
    const controller = session.mcps.find(item => item.id === session.controllerMcpId)
    if (!controllerWorkspace) {
      return {
        success: false,
        error: 'controller workspace missing',
        mergeOrder: [],
        mergedBranches: [],
        failedBranches: [],
      }
    }

    const controllerState = await workspaceManager.inspectWorkspace(controllerWorkspace)
    const repositoryIssues = [
      controllerState.lockExists ? 'git-lock' : '',
      controllerState.mergeInProgress ? 'merge-in-progress' : '',
      controllerState.rebaseInProgress ? 'rebase-in-progress' : '',
      controllerState.cherryPickInProgress ? 'cherry-pick-in-progress' : '',
    ].filter(Boolean)

    if (repositoryIssues.length > 0) {
      return {
        success: false,
        conflicts: repositoryIssues,
        error: formatWorkspaceState(repositoryIssues),
        mergeOrder: [],
        mergedBranches: [],
        failedBranches: repositoryIssues.map(issue => ({ branch: controllerWorkspace.branch, error: issue })),
      }
    }

    const committed = await workspaceManager.commitOutputs(workspaces)

    if (!new PolicyEngine().canMerge(controller, session.controllerMcpId)) {
      return {
        success: false,
        error: 'controller merge permission denied',
        mergeOrder: [],
        mergedBranches: [],
        failedBranches: [{ branch: session.controllerMcpId, error: 'merge permission denied' }],
      }
    }

    const branchOrder = buildMergeOrder(session, workspaces).filter(branch => committed.includes(branch) || branch === controllerWorkspace.branch)
    const result = await workspaceManager.mergeByController(workspaces, controllerWorkspace, session.baseBranch, branchOrder)

    if (result.failed.length > 0) {
      return {
        success: false,
        conflicts: result.failed.map(item => item.branch),
        error: result.failed.map(item => `${item.branch}:${item.error || 'merge failed'}`).join(', '),
        mergeOrder: branchOrder,
        mergedBranches: result.merged,
        failedBranches: result.failed,
      }
    }

    return {
      success: true,
      conflicts: [],
      error: undefined,
      mergeOrder: branchOrder,
      mergedBranches: result.merged,
      failedBranches: [],
    }
  }
}
