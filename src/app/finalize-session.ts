import type { ExecutionSession, SessionPhase } from '../types.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { PolicyEngine } from '../core/policy/policy-engine.js'
import { QualityGate } from '../core/quality/quality-gate.js'
import { GitMergeService } from '../core/git/git-merge-service.js'
import { FailureRecovery } from '../core/recovery/failure-recovery.js'
import { ReportBuilder } from '../core/report/report-builder.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { parseReviewArtifacts, approvalsFromArtifacts } from '../core/orchestrator.js'
import { parseWorkspaceMap } from './foreground-execution.js'
import { renderExecutionSummaryTable } from '../core/terminal/ui.js'

export async function finalizeSession(projectRoot: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  let session = runtime.load()
  if (!session) return '没有活跃的 session。'

  if (session.phase === 'planning') return '当前 session 还在 planning 阶段。'
  if (session.phase === 'completed') return '当前 session 已完成。请调用 parallel_report 查看结果。'

  const scheduler = new Scheduler()
  const policy = new PolicyEngine()
  session = scheduler.reconcile(session)

  const workspaces = parseWorkspaceMap(session.artifacts.workspaceMap)
  const reviewArtifacts = parseReviewArtifacts(session.artifacts, session.taskGraph.tasks)
  const reviewApprovals = approvalsFromArtifacts(reviewArtifacts)
  session = scheduler.reconcile({ ...session, reviewArtifacts, reviewApprovals })

  const governanceAudit = policy.buildGovernanceAudit(session, session.reviewAssignments || [], reviewApprovals)
  const qualityGate = await new QualityGate().runAll(projectRoot, session, reviewApprovals)
  const mergeResult = await new GitMergeService(projectRoot).merge(session, workspaces)
  const recovery = !mergeResult.success
    ? await new FailureRecovery(projectRoot).recover(session, mergeResult.error || 'merge failed', workspaces)
    : []

  const failed = session.taskGraph.tasks.filter(t => t.status === 'failed').length
  const finalPhase: SessionPhase = failed > 0 || !qualityGate.passed || !mergeResult.success ? 'failed' : 'completed'

  const auditRecords = [
    createAuditRecord({
      sessionId: session.sessionId,
      scope: 'merge',
      action: 'finalize-merge',
      status: mergeResult.success ? 'passed' : 'failed',
      actor: session.controllerMcpId,
      message: mergeResult.success ? 'merge completed' : (mergeResult.error || 'merge failed'),
    }),
    ...recovery.map(item => createAuditRecord({
      sessionId: session.sessionId,
      scope: item.action?.startsWith('rollback') ? 'rollback' : 'recovery',
      action: item.action || 'recovery-step',
      status: item.status,
      actor: item.mcpId,
      mcpId: item.mcpId,
      taskId: item.taskId,
      message: item.message,
      metadata: item.suggestion ? { suggestion: item.suggestion } : undefined,
    })),
  ]

  let finalSession: ExecutionSession = {
    ...session,
    phase: finalPhase,
    qualityGate,
    governanceAudit,
    reviewArtifacts,
    reviewApprovals,
    recovery,
    artifacts: {
      ...session.artifacts,
      mergeResult: JSON.stringify(mergeResult, null, 2),
    },
    resumeCursor: {
      phase: finalPhase,
      taskIds: session.taskGraph.tasks.filter(t => t.status !== 'completed').map(t => t.id),
    },
  }
  finalSession = runtime.appendAudit(finalSession, auditRecords)
  runtime.save(finalSession)

  const report = new ReportBuilder().build(finalSession)
  return renderExecutionSummaryTable(report)
}
