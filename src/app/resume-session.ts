import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { ContractValidator } from '../core/contracts/contract-validator.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { WorkspaceManager } from '../core/workspace/workspace-manager.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { buildContextSummary } from '../core/context/context-summary.js'
import { buildMergeSummaryLines, executeSessionPipeline } from '../core/orchestrator.js'
import type { ExecutionSession, MergeResult, WorkspaceDescriptor } from '../types.js'

function blockedReasons(artifacts: string[]): string[] {
  return artifacts.filter(item => item.startsWith('blocked-by-contract:'))
}

function parseMergeResult(artifacts: Record<string, string>): MergeResult | null {
  if (!artifacts.mergeResult) return null
  return JSON.parse(artifacts.mergeResult) as MergeResult
}

function recoverySummaryLines(sessionRecovery: Array<{ step: string; status: string; suggestion?: string }>): string[] {
  const latest = sessionRecovery.slice(-5)
  return latest.flatMap(item => [
    `recovery step: ${item.step} (${item.status})`,
    `recovery suggestion: ${item.suggestion || 'none'}`,
  ])
}

function parseWorkspaceMap(raw: string | undefined): Record<string, WorkspaceDescriptor> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, WorkspaceDescriptor>
  } catch {
    return {}
  }
}

async function inspectWorkspaceStates(projectRoot: string, workspaces: Record<string, WorkspaceDescriptor>): Promise<string[]> {
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

async function continueExecution(projectRoot: string, session: ExecutionSession, workspaces: Record<string, WorkspaceDescriptor>): Promise<ExecutionSession> {
  const runtime = new SessionRuntime(projectRoot)
  const scheduler = new Scheduler()
  const contractGate = new ContractValidator().validateAll(session.contracts)
  const context = buildContextSummary({
    goal: session.requirement,
    constraints: [`技术栈必须保持: ${session.stack.join(', ') || 'unknown'}`],
    analysis: 'parallel resume execution in progress',
    plan: session.taskGraph.tasks.map(task => `${task.id}:${task.title}`).join('\n'),
    risks: [],
    nextSteps: [],
    phase: session.phase,
  })

  const running = runtime.appendAudit(scheduler.requeueRecoverable({
    ...session,
    phase: 'running',
    contractGate,
  }), [
    createAuditRecord({
      sessionId: session.sessionId,
      scope: 'session',
      action: 'resume-execution',
      status: 'passed',
      actor: session.controllerMcpId,
      message: 'resume execution entered running phase',
    }),
  ])
  runtime.save(running)

  return executeSessionPipeline({
    projectRoot,
    session: running,
    workspaces,
    contracts: running.contracts,
    context,
    taskAction: 'resume-task-execution',
    mergeAction: 'resume-merge-session',
    mergeSuccessMessage: 'merge completed during resume',
    mergeFailureFallback: 'merge failed during resume',
  })
}

export async function resumeSession(projectRoot: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.resume()
  if (!session) return '当前没有可恢复的 parallel session。'

  const workspaceMap = parseWorkspaceMap(session.artifacts.workspaceMap)
  const liveWorkspaces = Object.entries(workspaceMap)
    .map(([mcpId, descriptor]) => `${mcpId}@${descriptor.path}`)
    .join(', ')
  const workspaceStates = await inspectWorkspaceStates(projectRoot, workspaceMap)

  const resumed = await continueExecution(projectRoot, session, workspaceMap)
  const mergeResult = parseMergeResult(resumed.artifacts)
  const blocked = resumed.taskGraph.tasks
    .filter(task => task.status === 'blocked')
    .map(task => `${task.id}[${blockedReasons(task.artifacts).join(', ') || 'unknown'}]`)
    .join(', ')

  return [
    `✅ resumed session: ${resumed.sessionId}`,
    `phase: ${resumed.phase}`,
    `governance: ${resumed.governance?.status || 'pending'}`,
    `resume tasks: ${resumed.resumeCursor.taskIds.join(', ') || 'none'}`,
    `contracts: ${resumed.contracts.length}`,
    `contract gate: ${resumed.contractGate?.passed ? 'passed' : 'failed'}`,
    `quality gate: ${resumed.qualityGate?.passed ? 'passed' : 'failed'}`,
    `review assignments: ${resumed.reviewAssignments?.length || 0}`,
    `review artifacts: ${resumed.reviewArtifacts?.length || 0}`,
    `review approvals: ${resumed.reviewApprovals?.length || 0}`,
    ...buildMergeSummaryLines(mergeResult),
    `blocked reasons: ${blocked || 'none'}`,
    `telemetry: ${resumed.telemetry.length}`,
    `audit trail: ${resumed.auditTrail?.length || 0}`,
    `workspaces: ${liveWorkspaces || 'none'}`,
    `workspace states: ${workspaceStates.join(', ') || 'clean'}`,
    `models: ${resumed.mcps.map(mcp => `${mcp.id}:${mcp.activeModel}`).join(', ')}`,
    ...recoverySummaryLines(resumed.recovery || []),
  ].join('\n')
}
