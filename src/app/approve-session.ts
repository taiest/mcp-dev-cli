import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { WorkspaceManager } from '../core/workspace/workspace-manager.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { createAgentFiles, summarizeAssignments, summarizeCreatedRoles } from './start-parallel-session.js'
import { runForegroundExecution } from './foreground-execution.js'
import { renderExecutionPlan, renderSessionOutcome } from '../core/terminal/renderers.js'
import type { ExecutionSession } from '../types.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

function withPreparedExecution(
  runtime: SessionRuntime,
  session: ExecutionSession,
  workspaceMap: Record<string, { id: string; mcpId: string; branch: string; path: string }>,
): ExecutionSession {
  return runtime.appendAudit({
    ...session,
    phase: 'running',
    artifacts: {
      ...session.artifacts,
      workspaceMap: JSON.stringify(workspaceMap, null, 2),
      assignmentSummary: JSON.stringify(summarizeAssignments(session), null, 2),
    },
  }, [
    createAuditRecord({
      sessionId: session.sessionId,
      scope: 'session',
      action: 'approve-execution',
      status: 'passed',
      actor: session.controllerMcpId,
      message: 'execution plan approved and workspaces prepared',
      metadata: {
        workspaceCount: String(Object.keys(workspaceMap).length),
      },
    }),
  ])
}

export async function approveSession(projectRoot: string, server?: Server): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) {
    return [
      '✅ Parallel Approval',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '当前没有待审批的 parallel session。',
      '',
      '建议下一步：',
      '- 先运行 parallel_startup，确认当前项目状态。',
      '- 然后输入需求并调用 parallel_start 生成执行计划。',
    ].join('\n')
  }

  if (session.phase !== 'planning') {
    return renderSessionOutcome({
      action: 'blocked',
      sessionId: session.sessionId,
      phase: session.phase,
      summary: [
        ['current phase', session.phase],
      ],
      sections: [
        {
          title: 'Approval State',
          lines: [
            session.phase === 'completed'
              ? '当前 session 已完成，无需再审批执行。'
              : '当前 session 不在 planning 阶段，不能走 parallel_approve。',
            '如需查看当前状态，可运行 parallel_dashboard。',
          ],
        },
      ],
      nextStep: session.phase === 'completed' ? 'Use parallel_report to inspect the final summary.' : 'Use parallel_dashboard or parallel_resume based on the current phase.',
    })
  }

  const plannedView = buildDashboardView(session)
  const workspaceManager = new WorkspaceManager(projectRoot)
  const workspaces = await workspaceManager.prepare(session)
  const running = withPreparedExecution(runtime, session, workspaces)
  const createdRoles = createAgentFiles(projectRoot, running)
  const prepared: ExecutionSession = {
    ...running,
    artifacts: {
      ...running.artifacts,
      createdRoles: JSON.stringify(createdRoles, null, 2),
    },
  }
  runtime.save(prepared)

  const execution = await runForegroundExecution({
    projectRoot,
    session: prepared,
    workspaces,
    title: '✅ Parallel Execution Approved',
    nextStep: finalSession => finalSession.phase === 'completed'
      ? 'Use parallel_report to review the final execution summary.'
      : 'Use parallel_dashboard to inspect blockers, recovery suggestions, and latest lane state.',
    contextAnalysis: 'parallel approval execution in progress',
    taskAction: 'approve-task-execution',
    mergeAction: 'approve-merge-session',
    mergeSuccessMessage: 'merge completed after approval',
    mergeFailureFallback: 'merge failed after approval',
    server,
  })

  return [
    renderExecutionPlan(plannedView),
    '',
    'Created Roles',
    ...summarizeCreatedRoles(createdRoles),
    '',
    execution.output,
  ].join('\n')
}
