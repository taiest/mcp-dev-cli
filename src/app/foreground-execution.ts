import type { ExecutionSession, ExecutionSummaryReport, ParallelProgressEvent, WorkspaceDescriptor } from '../types.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ContractValidator } from '../core/contracts/contract-validator.js'
import { executeSessionPipeline } from '../core/orchestrator.js'
import { ReportBuilder } from '../core/report/report-builder.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { renderExecutionSummaryTable, shouldBroadcast, formatTaskProgress, formatMergeProgress, formatControllerDecision, type WorkerLiveState } from '../core/terminal/ui.js'
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

import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

function formatDurationCompact(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
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
  extra?: ToolExtra
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
  let lastControllerBroadcast = 0
  const WORKER_THROTTLE_MS = 4_000
  const CONTROLLER_THROTTLE_MS = 2_500

  let progressCount = 0
  const pendingTasks = options.session.taskGraph.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed').length
  const totalEstimate = Math.max(pendingTasks, 1) * 10

  const sendProgress = (message: string) => {
    if (!options.extra?._meta?.progressToken) return
    progressCount++
    options.extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken: options.extra._meta.progressToken,
        progress: Math.min(progressCount, totalEstimate - 1),
        total: totalEstimate,
        message: message.slice(0, 200),
      },
    }).catch(() => {})
  }

  // Heartbeat: send progress every 15s even if no broadcast fires, to prevent MCP timeout
  const heartbeat = setInterval(() => {
    const summary = Array.from(workerStates.values())
      .map(w => `${w.mcpId}:${w.status}`)
      .join(' | ') || 'waiting'
    broadcast(`heartbeat: ${summary}`)
  }, 15_000)

  const broadcast = (msg: string) => {
    if (!options.server) return
    options.server.sendLoggingMessage({ level: 'info', logger: 'mcp-dev-cli', data: msg }).catch(() => {})
    sendProgress(msg)
  }

  const broadcastWorkerTable = () => {
    if (workerStates.size === 0) return
    const now = Date.now()
    const lines = Array.from(workerStates.values()).map(w => {
      const elapsed = formatDurationCompact(w.durationMs ?? (now - w.startedAt))
      const icon = w.status === 'completed' ? '✅' : w.status === 'failed' ? '❌' : '🔄'
      const tokens = w.totalTokens ? `${Math.round(w.totalTokens / 1000)}k` : '-'
      const snippet = (w.snippet || '').slice(0, 30)
      return `${icon} ${w.mcpId} ${w.taskId} ${elapsed} ${tokens}t ${snippet}`
    })
    broadcast(lines.join('\n'))
  }

  const broadcastControllerConsole = (session: ExecutionSession, force = false) => {
    const now = Date.now()
    if (!force && now - lastControllerBroadcast < CONTROLLER_THROTTLE_MS) return
    lastControllerBroadcast = now
    const lanes = session.laneStates || []
    const running = lanes.filter(l => l.status === 'running').length
    const done = lanes.reduce((s, l) => s + l.completedTaskCount, 0)
    const decisions = (session.controllerDecisions || []).slice(-2)
    const lines = [
      `🧠 ${running} running | ${done} done`,
      ...decisions.map(d => `  ${d.timestamp.slice(11, 19)} ${d.summary.slice(0, 50)}`),
    ]
    broadcast(lines.join('\n'))
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

      if (event.kind === 'controller' && session) {
        broadcast(formatControllerDecision(event))
        broadcastControllerConsole(session, true)
        return
      }

      // Track worker states
      if (event.kind === 'worker' && event.mcpId) {
        sendProgress(`${event.mcpId}: ${event.snippet || event.status || 'running'}`)
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
          if (session) broadcastControllerConsole(session)
        } else {
          existing.status = status
          if (event.snippet) existing.snippet = event.snippet
          if (event.durationMs) existing.durationMs = event.durationMs
          if (event.activeModel) existing.activeModel = event.activeModel
          if (event.totalTokens) existing.totalTokens = event.totalTokens

          if (status === 'completed' || status === 'failed') {
            broadcastWorkerTable()
            if (session) broadcastControllerConsole(session, true)
          } else {
            const now = Date.now()
            if (now - lastWorkerBroadcast >= WORKER_THROTTLE_MS) {
              lastWorkerBroadcast = now
              broadcastWorkerTable()
            }
            if (session) broadcastControllerConsole(session)
          }
        }
        return
      }

      if (!shouldBroadcast(event)) return

      if (event.kind === 'batch' && event.message.includes('dispatching') && session) {
        const dispatched = session.taskGraph.tasks.filter(t => t.assignedMcpId)
        const lines = dispatched.map(t => `  ${t.assignedMcpId} ${t.roleType} → ${t.id}: ${t.title.slice(0, 30)}`)
        broadcast(`🚀 dispatching ${dispatched.length} tasks\n${lines.join('\n')}`)
      } else if (event.kind === 'task') {
        broadcast(formatTaskProgress(event))
        if (session) broadcastControllerConsole(session)
      } else if (event.kind === 'merge' || event.kind === 'recovery') {
        broadcast(formatMergeProgress(event))
      } else {
        broadcast(`${event.kind}: ${event.message}`)
      }
    },
  })

  clearInterval(heartbeat)

  // Send final progress = total to signal completion
  if (options.extra?._meta?.progressToken) {
    options.extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken: options.extra._meta.progressToken,
        progress: totalEstimate,
        total: totalEstimate,
        message: 'execution complete',
      },
    }).catch(() => {})
  }

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
