import type { ExecutionSession, RecoveryRecord, WorkspaceDescriptor } from '../../types.js'
import { WorkspaceManager } from '../workspace/workspace-manager.js'

function timestamp(): string {
  return new Date().toISOString()
}

export class GitRollbackService {
  constructor(private projectRoot: string) {}

  async rollback(session: ExecutionSession, reason: string, workspaces: Record<string, WorkspaceDescriptor>): Promise<RecoveryRecord[]> {
    const workspaceManager = new WorkspaceManager(this.projectRoot)
    const records: RecoveryRecord[] = []
    const controllerWorkspace = workspaces[session.controllerMcpId]

    if (controllerWorkspace) {
      const cleared = await workspaceManager.clearWorkspaceState(controllerWorkspace)
      records.push({
        step: 'rollback-merge-step',
        status: 'passed',
        message: `controller rollback prepared for ${session.sessionId}: ${reason}`,
        timestamp: timestamp(),
        mcpId: session.controllerMcpId,
        action: 'rollback-merge-step',
        suggestion: cleared.length > 0
          ? `controller workspace ${controllerWorkspace.path} 已清理 ${cleared.join(', ')} 中间态，可继续 resume。`
          : `controller workspace ${controllerWorkspace.path} 未发现 merge/rebase/cherry-pick 中间态。`,
      })
    } else {
      records.push({
        step: 'rollback-merge-step',
        status: 'failed',
        message: `controller workspace missing for ${session.sessionId}`,
        timestamp: timestamp(),
        mcpId: session.controllerMcpId,
        action: 'manual-attention',
        suggestion: '未找到 controller workspace，需先检查 workspaceMap 后再 resume。',
      })
    }

    const taskWorkspaces = new Map(Object.entries(workspaces))
    for (const task of session.taskGraph.tasks.filter(item => item.status === 'failed' && item.assignedMcpId)) {
      const workspace = taskWorkspaces.get(task.assignedMcpId as string)
      if (!workspace) {
        records.push({
          step: `rollback-task:${task.id}`,
          status: 'failed',
          message: `${task.id} workspace missing`,
          timestamp: timestamp(),
          taskId: task.id,
          mcpId: task.assignedMcpId,
          action: 'manual-attention',
          suggestion: `未找到 ${task.id} 对应 workspace，需手工检查 ${task.assignedMcpId} 分支状态。`,
        })
        continue
      }

      const cleared = await workspaceManager.rollbackWorkspaceTask(workspace)
      records.push({
        step: `rollback-task:${task.id}`,
        status: 'passed',
        message: `${task.id} rollback prepared in ${workspace.branch}`,
        timestamp: timestamp(),
        taskId: task.id,
        mcpId: task.assignedMcpId,
        action: 'rollback-single-task',
        suggestion: cleared.length > 0
          ? `${workspace.branch} 已清理 ${cleared.join(', ')} 中间态，可单独修复 ${task.id} 后继续。`
          : `${workspace.branch} 未发现中间态，可直接修复 ${task.id} 并 resume。`,
      })
    }

    return records
  }
}
