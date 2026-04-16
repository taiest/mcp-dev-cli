import type { ReviewApproval, ReviewAssignment } from '../../types.js'

export class ReviewGate {
  pass(assignments: ReviewAssignment[] = [], approvals: ReviewApproval[] = []): boolean {
    if (assignments.length === 0) return true
    const approvedTaskIds = new Set(approvals.filter(item => item.approved).map(item => item.taskId))
    const rejectedTaskIds = new Set(approvals.filter(item => !item.approved).map(item => item.taskId))
    const requiredTaskIds = Array.from(new Set(assignments.map(item => item.taskId)))
    return requiredTaskIds.length > 0
      && requiredTaskIds.every(taskId => approvedTaskIds.has(taskId))
      && rejectedTaskIds.size === 0
  }
}
