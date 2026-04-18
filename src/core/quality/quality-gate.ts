import { execa } from 'execa'
import type { ExecutionSession, PreflightReport, ReviewApproval, ReviewAssignment } from '../../types.js'
import { getQualityCommands } from '../../utils/platform.js'
import { isReadOnlyValidationText } from '../worker/validation-task.js'

async function runCommands(commands: string[], projectRoot: string): Promise<boolean> {
  if (commands.length === 0) return true

  for (const command of commands) {
    const result = await execa(command, {
      cwd: projectRoot,
      shell: true,
      reject: false,
      timeout: 600_000,
    })
    if (result.exitCode !== 0) return false
  }

  return true
}

function reviewPassed(assignments: ReviewAssignment[] = [], approvals: ReviewApproval[] = []): boolean {
  if (assignments.length === 0) return true
  const approvedTaskIds = new Set(approvals.filter(item => item.approved).map(item => item.taskId))
  const rejectedTaskIds = new Set(approvals.filter(item => !item.approved).map(item => item.taskId))
  const requiredTaskIds = Array.from(new Set(assignments.map(item => item.taskId)))
  return requiredTaskIds.length > 0
    && requiredTaskIds.every(taskId => approvedTaskIds.has(taskId))
    && rejectedTaskIds.size === 0
}

export class QualityGate {
  async runAll(projectRoot: string, session: Pick<ExecutionSession, 'requirement' | 'reviewAssignments'>, approvals: ReviewApproval[] = []): Promise<PreflightReport> {
    if (isReadOnlyValidationText(session.requirement)) {
      return {
        passed: true,
        checks: [
          {
            name: 'quality:validation',
            status: 'passed',
            message: '只读 validation session 跳过常规质量门禁',
            autoFixable: false,
          },
        ],
      }
    }

    const commands = getQualityCommands(projectRoot)
    const [testsPassed, lintPassed, securityPassed] = await Promise.all([
      runCommands(commands.test, projectRoot),
      runCommands(commands.lint, projectRoot),
      runCommands(commands.security, projectRoot),
    ])
    const passedReview = reviewPassed(session.reviewAssignments || [], approvals)
    const checks = [
      {
        name: 'quality:test',
        status: testsPassed ? 'passed' : 'failed',
        message: testsPassed ? '测试通过' : '测试未通过',
        autoFixable: false,
      },
      {
        name: 'quality:lint',
        status: lintPassed ? 'passed' : 'failed',
        message: lintPassed ? 'Lint 通过' : 'Lint 未通过',
        autoFixable: false,
      },
      {
        name: 'quality:security',
        status: securityPassed ? 'passed' : 'failed',
        message: securityPassed ? '安全扫描通过' : '安全扫描未通过',
        autoFixable: false,
      },
      {
        name: 'quality:review',
        status: passedReview ? 'passed' : 'failed',
        message: passedReview
          ? `Review gate 通过 (${approvals.filter(item => item.approved).length} approvals)`
          : 'Review gate 未通过或仍缺少授权审批',
        autoFixable: false,
      },
    ] as const

    return {
      passed: checks.every(check => check.status !== 'failed'),
      checks: [...checks],
    }
  }
}
