import type {
  ExecutionSession,
  GovernanceAuditRecord,
  GovernancePolicy,
  McpAction,
  McpNode,
  OrchestratedTask,
  PreflightReport,
  ReviewApproval,
  ReviewAssignment,
} from '../../types.js'

function defaultGovernancePolicy(node: McpNode, controllerMcpId: string): GovernancePolicy {
  const isController = node.id === controllerMcpId
  return {
    canAssign: isController || node.permissions.includes('assign'),
    canExecute: isController || node.permissions.includes('execute'),
    canReview: isController || node.permissions.includes('review') || node.roleType === 'reviewer',
    canApprove: isController || node.permissions.includes('approve') || node.permissions.includes('review') || node.roleType === 'reviewer',
    canMerge: isController && node.permissions.includes('merge'),
    canOverride: isController || node.permissions.includes('override'),
  }
}

export class PolicyEngine {
  controllerCanManage(mcpId: string, controllerMcpId: string): boolean {
    return mcpId === controllerMcpId
  }

  canReview(node: McpNode, controllerMcpId: string): boolean {
    return this.resolveGovernancePolicy(node, controllerMcpId).canReview
  }

  canApprove(node: McpNode, controllerMcpId: string): boolean {
    return this.resolveGovernancePolicy(node, controllerMcpId).canApprove
  }

  canExecuteTask(node: McpNode, task: OrchestratedTask, controllerMcpId: string): boolean {
    const policy = this.resolveGovernancePolicy(node, controllerMcpId)
    if (task.roleType === 'reviewer') {
      return policy.canReview
    }
    return policy.canExecute
  }

  canManageTask(node: McpNode | undefined, controllerMcpId: string): boolean {
    if (!node) return false
    return this.resolveGovernancePolicy(node, controllerMcpId).canAssign
  }

  canAssignReviewer(actor: McpNode | undefined, reviewer: McpNode | undefined, controllerMcpId: string): boolean {
    if (!actor || !reviewer) return false
    const actorPolicy = this.resolveGovernancePolicy(actor, controllerMcpId)
    const reviewerPolicy = this.resolveGovernancePolicy(reviewer, controllerMcpId)
    return actorPolicy.canAssign && reviewerPolicy.canReview
  }

  canMerge(node: McpNode | undefined, controllerMcpId: string): boolean {
    if (!node) return false
    return this.resolveGovernancePolicy(node, controllerMcpId).canMerge
  }

  buildReviewAssignments(session: ExecutionSession): ReviewAssignment[] {
    const controller = session.mcps.find(mcp => mcp.id === session.controllerMcpId)
    const reviewers = session.mcps.filter(mcp => this.canReview(mcp, session.controllerMcpId))
    if (!controller || reviewers.length === 0) return []

    return session.taskGraph.tasks
      .filter(task => task.reviewRequired)
      .flatMap(task => reviewers
        .filter(reviewer => this.canAssignReviewer(controller, reviewer, session.controllerMcpId))
        .map(reviewer => ({
          taskId: task.id,
          reviewerMcpId: reviewer.id,
          authorizedBy: controller.id,
          authorizedAt: new Date().toISOString(),
        })))
  }

  buildGovernanceAudit(session: ExecutionSession, assignments: ReviewAssignment[], approvals: ReviewApproval[] = []): GovernanceAuditRecord[] {
    const records: GovernanceAuditRecord[] = []
    const controller = session.mcps.find(mcp => mcp.id === session.controllerMcpId)

    for (const task of session.taskGraph.tasks) {
      const node = session.mcps.find(mcp => mcp.id === task.assignedMcpId)
      records.push(this.auditAction('execute', node, task.id, undefined, this.canExecuteTask(node as McpNode, task, session.controllerMcpId), node
        ? `${task.id} 执行权限${this.canExecuteTask(node, task, session.controllerMcpId) ? '通过' : '拒绝'}`
        : `${task.id} 未找到执行节点`))
    }

    for (const assignment of assignments) {
      const reviewer = session.mcps.find(mcp => mcp.id === assignment.reviewerMcpId)
      records.push(this.auditAction(
        'review',
        reviewer,
        assignment.taskId,
        assignment.reviewerMcpId,
        this.canAssignReviewer(controller, reviewer, session.controllerMcpId),
        this.canAssignReviewer(controller, reviewer, session.controllerMcpId)
          ? `${assignment.reviewerMcpId} 已被授权 review ${assignment.taskId}`
          : `${assignment.reviewerMcpId} 无权 review ${assignment.taskId}`,
        assignment.authorizedBy,
      ))
    }

    for (const approval of approvals) {
      const reviewer = session.mcps.find(mcp => mcp.id === approval.reviewerMcpId)
      records.push(this.auditAction(
        'approve',
        reviewer,
        approval.taskId,
        approval.reviewerMcpId,
        Boolean(reviewer) && this.canApprove(reviewer as McpNode, session.controllerMcpId),
        approval.approved ? `${approval.reviewerMcpId} approved ${approval.taskId}` : `${approval.reviewerMcpId} rejected ${approval.taskId}`,
      ))
    }

    records.push(this.auditAction(
      'merge',
      controller,
      undefined,
      session.controllerMcpId,
      this.canMerge(controller, session.controllerMcpId),
      this.canMerge(controller, session.controllerMcpId) ? 'controller merge permission granted' : 'controller merge permission denied',
    ))

    return records
  }

  validateSession(session: ExecutionSession): PreflightReport {
    const checks = [] as PreflightReport['checks']
    const controller = session.mcps.find(mcp => mcp.id === session.controllerMcpId)
    const controllerPolicy = controller ? this.resolveGovernancePolicy(controller, session.controllerMcpId) : undefined
    const controllerReady = Boolean(controller && controllerPolicy?.canAssign && controllerPolicy.canReview && controllerPolicy.canMerge)

    checks.push({
      name: 'policy:controller',
      status: controllerReady ? 'passed' : 'failed',
      message: controllerReady ? 'controller 权限校验通过' : 'controller 缺少 assign/review/merge 权限',
      autoFixable: false,
    })

    const reviewAssignments = this.buildReviewAssignments(session)
    const reviewTaskIds = new Set(reviewAssignments.map(item => item.taskId))

    for (const task of session.taskGraph.tasks) {
      if (!task.assignedMcpId) {
        checks.push({
          name: `policy:${task.id}`,
          status: 'failed',
          message: `${task.id} 未分配执行节点`,
          autoFixable: false,
        })
        continue
      }

      const node = session.mcps.find(mcp => mcp.id === task.assignedMcpId)
      const valid = Boolean(node) && this.canExecuteTask(node as McpNode, task, session.controllerMcpId)
      checks.push({
        name: `policy:${task.id}`,
        status: valid ? 'passed' : 'failed',
        message: valid
          ? `${task.id} 权限校验通过`
          : `${task.id} 分配给了无权限节点 ${task.assignedMcpId}`,
        autoFixable: false,
      })

      if (task.reviewRequired) {
        checks.push({
          name: `policy:review:${task.id}`,
          status: reviewTaskIds.has(task.id) ? 'passed' : 'failed',
          message: reviewTaskIds.has(task.id)
            ? `${task.id} review 授权已建立`
            : `${task.id} 缺少授权 reviewer`,
          autoFixable: false,
        })
      }
    }

    return {
      passed: checks.every(check => check.status !== 'failed'),
      checks,
    }
  }

  private resolveGovernancePolicy(node: McpNode, controllerMcpId: string): GovernancePolicy {
    return node.governancePolicy || defaultGovernancePolicy(node, controllerMcpId)
  }

  private auditAction(
    action: McpAction,
    actor: McpNode | undefined,
    targetTaskId: string | undefined,
    targetMcpId: string | undefined,
    allowed: boolean,
    reason: string,
    actorMcpId?: string,
  ): GovernanceAuditRecord {
    return {
      action,
      actorMcpId: actorMcpId || actor?.id || 'unknown',
      targetTaskId,
      targetMcpId,
      allowed,
      reason,
      timestamp: new Date().toISOString(),
    }
  }
}
