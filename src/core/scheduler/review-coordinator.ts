import type { ExecutionSession, GovernanceState, ReviewAssignment } from '../../types.js'
import { PolicyEngine } from '../policy/policy-engine.js'

function buildGovernanceState(session: ExecutionSession, assignments: ReviewAssignment[]): GovernanceState {
  const reviewRequiredTaskIds = session.taskGraph.tasks.filter(task => task.reviewRequired).map(task => task.id)
  const reviewAssignedTaskIds = assignments.map(item => item.taskId)
  const approvedTaskIds = session.reviewApprovals?.filter(item => item.approved).map(item => item.taskId) || []
  const rejectedTaskIds = session.reviewApprovals?.filter(item => !item.approved).map(item => item.taskId) || []
  const readyForMerge = reviewRequiredTaskIds.every(taskId => approvedTaskIds.includes(taskId)) && rejectedTaskIds.length === 0

  const status: GovernanceState['status'] = rejectedTaskIds.length > 0
    ? 'review_rejected'
    : !reviewRequiredTaskIds.length
      ? 'pending'
      : reviewAssignedTaskIds.length < reviewRequiredTaskIds.length
        ? 'review_required'
        : !readyForMerge
          ? 'waiting_approval'
          : 'ready_for_merge'

  return {
    status,
    reviewRequiredTaskIds,
    reviewAssignedTaskIds,
    approvedTaskIds,
    rejectedTaskIds,
    readyForMerge,
    mergeApprovedBy: readyForMerge ? session.controllerMcpId : undefined,
  }
}

export class ReviewCoordinator {
  private policy = new PolicyEngine()

  assignReviewers(session: ExecutionSession): ExecutionSession {
    const assignments = this.policy.buildReviewAssignments(session)
    const assignedTaskIds = new Set(assignments.map(item => item.taskId))

    return {
      ...session,
      reviewAssignments: assignments,
      governance: buildGovernanceState(session, assignments),
      taskGraph: {
        tasks: session.taskGraph.tasks.map(task => {
          const taskAssignments = assignments.filter(item => item.taskId === task.id).map(item => item.reviewerMcpId)
          const approvedBy = session.reviewApprovals?.filter(item => item.taskId === task.id && item.approved).map(item => item.reviewerMcpId) || []
          const rejectedBy = session.reviewApprovals?.filter(item => item.taskId === task.id && !item.approved).map(item => item.reviewerMcpId) || []

          return {
            ...task,
            reviewAssignedTo: task.reviewRequired ? taskAssignments : task.reviewAssignedTo,
            approvedBy,
            rejectedBy,
            governanceStatus: task.reviewRequired
              ? rejectedBy.length > 0
                ? 'review_rejected'
                : assignedTaskIds.has(task.id)
                  ? approvedBy.length > 0
                    ? 'ready_for_merge'
                    : 'review_assigned'
                  : 'review_required'
              : 'pending',
          }
        }),
      },
    }
  }
}
