import type { ExecutionSession, ExecutionSummaryReport, ParallelProgressEvent, WorkspaceDescriptor } from '../types.js'
import { ContractValidator } from '../core/contracts/contract-validator.js'
import { executeSessionPipeline } from '../core/orchestrator.js'
import { ReportBuilder } from '../core/report/report-builder.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { renderControlExecution } from '../core/terminal/renderers.js'
import { WorkspaceManager } from '../core/workspace/workspace-manager.js'
import { buildContextSummary } from '../core/context/context-summary.js'

export function parseWorkspaceMap(raw: string | undefined): Record<string, WorkspaceDescriptor> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, WorkspaceDescriptor>
  } catch {
    return {}
  }
}

export async function inspectWorkspaceStates(projectRoot: string, workspaces: Record<string, WorkspaceDescriptor>): Promise<string[]> {
  const workspaceManager = new WorkspaceManager(projectRoot)
  const lines: string[] = []

  for (const descriptor of Object.values(workspaces)) {
    const state = await workspaceManager.inspectWorkspace(descriptor)
    const issues = [
      state.lockExists ? 'git-lock' : '',
      state.mergeInProgress ? 'merge' : '',
      state.rebaseInProgress ? 'rebase' : '',
      state.cherryPickInProgress ? 'cherry-pick' : '',
    ].filter(Boolean)

    if (issues.length > 0) {
      lines.push(`${descriptor.mcpId}@${descriptor.branch}:${issues.join('/')}`)
    }
  }

  return lines
}

export async function runForegroundExecution(options: {
  projectRoot: string
  session: ExecutionSession
  workspaces: Record<string, WorkspaceDescriptor>
  title: string
  nextStep: (session: ExecutionSession) => string
  contextAnalysis: string
  taskAction: string
  mergeAction: string
  mergeSuccessMessage: string
  mergeFailureFallback: string
}): Promise<{ session: ExecutionSession; report: ExecutionSummaryReport; progressEvents: ParallelProgressEvent[]; workspaceIssues: string[]; output: string }> {
  const runtime = new SessionRuntime(options.projectRoot)
  const scheduler = new Scheduler()
  const contractGate = new ContractValidator().validateAll(options.session.contracts)
  const context = buildContextSummary({
    goal: options.session.requirement,
    constraints: [`技术栈必须保持: ${options.session.stack.join(', ') || 'unknown'}`],
    analysis: options.contextAnalysis,
    plan: options.session.taskGraph.tasks.map(task => `${task.id}:${task.title}`).join('\n'),
    risks: [],
    nextSteps: [],
    phase: options.session.phase,
  })

  const running = runtime.appendAudit(scheduler.requeueRecoverable({
    ...options.session,
    phase: 'running',
    contractGate,
  }), [
    createAuditRecord({
      sessionId: options.session.sessionId,
      scope: 'session',
      action: options.taskAction,
      status: 'passed',
      actor: options.session.controllerMcpId,
      message: `${options.taskAction} entered running phase`,
    }),
  ])
  runtime.save(running)

  const progressEvents: ParallelProgressEvent[] = []
  const finalSession = await executeSessionPipeline({
    projectRoot: options.projectRoot,
    session: running,
    workspaces: options.workspaces,
    contracts: running.contracts,
    context,
    taskAction: options.taskAction,
    mergeAction: options.mergeAction,
    mergeSuccessMessage: options.mergeSuccessMessage,
    mergeFailureFallback: options.mergeFailureFallback,
    onProgress: event => {
      progressEvents.push(event)
    },
  })

  const report = new ReportBuilder().build(finalSession)
  runtime.saveReport(report)
  const workspaceIssues = await inspectWorkspaceStates(options.projectRoot, options.workspaces)
  const view = buildDashboardView(finalSession)

  return {
    session: finalSession,
    report,
    progressEvents,
    workspaceIssues,
    output: renderControlExecution({
      title: options.title,
      view,
      progressEvents,
      report,
      workspaceIssues,
      nextStep: options.nextStep(finalSession),
    }),
  }
}
