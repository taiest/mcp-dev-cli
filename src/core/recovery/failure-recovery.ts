import type { ExecutionSession, RecoveryRecord, WorkspaceDescriptor } from '../../types.js'
import { GitRollbackService } from '../git/git-rollback-service.js'
import { WorkspaceManager } from '../workspace/workspace-manager.js'

function timestamp(): string {
  return new Date().toISOString()
}

export class FailureRecovery {
  constructor(private projectRoot: string) {}

  async recover(session: ExecutionSession, reason: string, workspaces: Record<string, WorkspaceDescriptor>): Promise<RecoveryRecord[]> {
    const steps: RecoveryRecord[] = []
    const failedTasks = session.taskGraph.tasks.filter(task => task.status === 'failed')
    const blockedTasks = session.taskGraph.tasks.filter(task => task.status === 'blocked')
    const workspaceManager = new WorkspaceManager(this.projectRoot)

    steps.push({
      step: 'detect-failure',
      status: 'passed',
      message: reason,
      timestamp: timestamp(),
      action: 'diagnose',
      suggestion: this.buildSessionSuggestion(failedTasks.length, blockedTasks.length, reason),
    })

    for (const task of failedTasks) {
      const workspace = task.assignedMcpId ? workspaces[task.assignedMcpId] : undefined
      const repositoryState = workspace
        ? await workspaceManager.inspectWorkspace(workspace)
        : undefined

      if (repositoryState?.lockExists) {
        steps.push({
          step: `git-lock:${task.id}`,
          status: 'failed',
          message: `${task.title} blocked by git lock`,
          timestamp: timestamp(),
          taskId: task.id,
          mcpId: task.assignedMcpId,
          action: 'manual-attention',
          suggestion: `检测到 ${workspace?.branch || task.assignedMcpId} 存在 index.lock，确认无其他 Git 进程后清理锁文件再 resume。`,
        })
      }

      const inProgressStates = [
        repositoryState?.mergeInProgress ? 'merge' : '',
        repositoryState?.rebaseInProgress ? 'rebase' : '',
        repositoryState?.cherryPickInProgress ? 'cherry-pick' : '',
      ].filter(Boolean)

      if (inProgressStates.length > 0) {
        steps.push({
          step: `git-state:${task.id}`,
          status: 'failed',
          message: `${task.title} has in-progress git state`,
          timestamp: timestamp(),
          taskId: task.id,
          mcpId: task.assignedMcpId,
          action: 'rollback-single-task',
          suggestion: `${workspace?.branch || task.assignedMcpId} 发现 ${inProgressStates.join(', ')} 中间态，先执行单任务回滚再继续。`,
        })
      }

      steps.push({
        step: `diagnose-task:${task.id}`,
        status: 'failed',
        message: `${task.title} failed on ${task.assignedMcpId || 'unassigned'}`,
        timestamp: timestamp(),
        taskId: task.id,
        mcpId: task.assignedMcpId,
        action: 'retry',
        suggestion: `优先重试 ${task.id}；若再次失败，则改为 reassign、rollback-single-task 或 switch-model。`,
      })

      if (task.assignedMcpId) {
        const backup = session.mcps.find(mcp =>
          mcp.id !== task.assignedMcpId
          && mcp.status !== 'failed'
          && (mcp.permissions.includes('execute') || mcp.roleType === task.roleType || mcp.roleType === 'controller')
        )

        if (backup) {
          steps.push({
            step: `reassign-candidate:${task.id}`,
            status: 'passed',
            message: `${task.id} can move from ${task.assignedMcpId} to ${backup.id}`,
            timestamp: timestamp(),
            taskId: task.id,
            mcpId: backup.id,
            action: 'reassign',
            suggestion: `如需隔离当前节点失败，可把 ${task.id} 改派给 ${backup.id}。`,
          })
        }
      }
    }

    for (const task of blockedTasks) {
      steps.push({
        step: `blocked-task:${task.id}`,
        status: 'failed',
        message: `${task.id} is blocked`,
        timestamp: timestamp(),
        taskId: task.id,
        mcpId: task.assignedMcpId,
        action: 'replan',
        suggestion: this.blockedSuggestion(task.artifacts),
      })
    }

    steps.push(...await new GitRollbackService(this.projectRoot).rollback(session, reason, workspaces))

    steps.push({
      step: 'resume-path',
      status: 'passed',
      message: `session ${session.sessionId} can resume after recovery actions`,
      timestamp: timestamp(),
      action: 'resume',
      suggestion: '修复失败任务、清理 Git 中间态或处理阻塞后，再执行 parallel_resume 继续推进。',
    })

    return steps
  }

  private buildSessionSuggestion(failedCount: number, blockedCount: number, reason: string): string {
    if (reason.includes('git-lock')) {
      return '本次失败集中在 Git 锁；需先确认无其他 Git 进程，再清锁并 resume。'
    }
    if (reason.includes('merge-in-progress') || reason.includes('rebase-in-progress') || reason.includes('cherry-pick-in-progress')) {
      return '检测到 Git 中间态；优先执行 rollback-single-task 或 rollback-merge-step，再继续。'
    }
    if (reason.includes('merge')) {
      return '本次失败集中在 merge 阶段；优先解决冲突分支，再 resume。'
    }
    if (reason.includes('quality')) {
      return '本次失败集中在质量门禁；优先修复测试或 lint，再 resume。'
    }
    if (failedCount > 0) {
      return `有 ${failedCount} 个失败任务，先 retry、rollback-single-task 或 reassign 这些任务。`
    }
    if (blockedCount > 0) {
      return `有 ${blockedCount} 个阻塞任务，先修复 contract/dependency 问题。`
    }
    return '先诊断失败原因，再决定 retry、reassign、rollback-single-task 或 replan。'
  }

  private blockedSuggestion(artifacts: string[]): string {
    const contractReason = artifacts.find(item => item.startsWith('blocked-by-contract:'))
    if (contractReason) {
      return `先修复 ${contractReason.replace('blocked-by-contract:', '')}，再恢复任务调度。`
    }
    return '先解除依赖阻塞，再执行 parallel_resume。'
  }
}
