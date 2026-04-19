import type { ExecutionSession, ExecutionSummaryReport, ParallelProgressEvent, WorkspaceDescriptor } from '../types.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ContractValidator } from '../core/contracts/contract-validator.js'
import { executeSessionPipeline } from '../core/orchestrator.js'
import { ReportBuilder } from '../core/report/report-builder.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { renderExecutionSummaryTable, shouldBroadcast, formatTaskProgress, formatMergeProgress, formatBatchDispatch, renderLiveWorkerTable, type WorkerLiveState } from '../core/terminal/ui.js'
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
  server?: Server
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
  const workerStates = new Map<string, WorkerLiveState>()
  let lastWorkerBroadcast = 0
  const WORKER_THROTTLE_MS = 8_000

  const broadcast = (msg: string) => {
    if (!options.server) return
    options.server.sendLoggingMessage({ level: 'info', logger: 'mcp-dev-cli', data: msg }).catch(() => {})
  }

  const broadcastWorkerTable = () => {
    if (workerStates.size === 0) return
    broadcast(renderLiveWorkerTable(workerStates))
  }

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
    onProgress: (event, session) => {
      progressEvents.push(event)

      // Track worker states
      if (event.kind === 'worker' && event.mcpId) {
        const key = event.mcpId
        const existing = workerStates.get(key)
        const status = (event.status || 'running') as WorkerLiveState['status']

        if (status === 'started' || !existing) {
          const task = session?.taskGraph.tasks.find(t => t.assignedMcpId === event.mcpId && (t.status === 'running' || t.id === event.taskId))
          workerStates.set(key, {
            mcpId: event.mcpId,
            taskId: event.taskId || task?.id || '?',
            roleType: task?.roleType || '?',
            status,
            startedAt: Date.now(),
            snippet: event.snippet || '',
            activeModel: event.activeModel || '',
          })
          broadcastWorkerTable()
        } else {
          existing.status = status
          if (event.snippet) existing.snippet = event.snippet
          if (event.durationMs) existing.durationMs = event.durationMs
          if (event.activeModel) existing.activeModel = event.activeModel
          if (event.totalTokens) existing.totalTokens = event.totalTokens

          if (status === 'completed' || status === 'failed') {
            broadcastWorkerTable()
          } else {
            const now = Date.now()
            if (now - lastWorkerBroadcast >= WORKER_THROTTLE_MS) {
              lastWorkerBroadcast = now
              broadcastWorkerTable()
            }
          }
        }
        return
      }

      if (!shouldBroadcast(event)) return

      if (event.kind === 'batch' && event.message.includes('dispatching') && session) {
        broadcast(formatBatchDispatch([event], session.taskGraph.tasks))
      } else if (event.kind === 'task') {
        broadcast(formatTaskProgress(event))
      } else if (event.kind === 'merge' || event.kind === 'recovery') {
        broadcast(formatMergeProgress(event))
      } else {
        broadcast(`${event.kind}: ${event.message}`)
      }
    },
  })

  const report = new ReportBuilder().build(finalSession)
  runtime.saveReport(report)
  const workspaceIssues = await inspectWorkspaceStates(options.projectRoot, options.workspaces)

  return {
    session: finalSession,
    report,
    progressEvents,
    workspaceIssues,
    output: renderExecutionSummaryTable(report),
  }
}
