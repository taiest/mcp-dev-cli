import type {
  ExecutionSummaryReport,
  McpMessage,
  ParallelProgressEvent,
  PreflightReport,
  ProjectCompletenessReport,
  ProjectConfigReport,
  SessionPhase,
  StartupFlowState,
} from '../../types.js'
import type { DashboardView } from '../report/dashboard-view.js'
import { isReadOnlyValidationText } from '../worker/validation-task.js'
import { header as uiHeader, statusIcon } from './ui.js'

function divider(char = '━', width = 52): string {
  return char.repeat(width)
}

function iconForState(status: string): string {
  if (['passed', 'completed', 'ready_for_merge', 'merged', 'success', 'available', 'ready', 'present'].includes(status)) return '✅'
  if (['warning', 'review_required', 'review_assigned', 'waiting_approval', 'running', 'reviewing', 'started', 'dispatching', 'merging', 'quality-gate', 'partial'].includes(status)) return '⚠️'
  if (['failed', 'review_rejected', 'blocked', 'missing'].includes(status)) return '❌'
  if (['pending', 'idle', 'assigned'].includes(status)) return '⏳'
  return '•'
}

function labelForPhase(phase: SessionPhase | string): string {
  return phase
}

function linesFromPairs(rows: Array<[string, string | number | boolean | undefined]>): string[] {
  const filtered = rows.filter(([, value]) => value !== undefined)
  const max = filtered.reduce((n, [key]) => Math.max(n, key.length), 0)
  return filtered.map(([key, value]) => `  ${key.padEnd(max)}  ${String(value)}`)
}

function renderSection(title: string, lines: string[]): string[] {
  if (lines.length === 0) return []
  return ['', title, ...lines]
}

function renderCompactSection(title: string, lines: string[]): string[] {
  if (lines.length === 0) return []
  return ['', `› ${title}`, ...lines]
}

function joinList(values: string[]): string {
  return values.length ? values.join(', ') : 'none'
}

function compactText(value: string, max = 56): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'idle'
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized
}

function isValidationView(view: DashboardView): boolean {
  return isReadOnlyValidationText(view.startup.requirement)
}

function mergeLabel(view: DashboardView): string {
  return isValidationView(view) ? 'validation' : 'merge'
}

function mergeStateText(success?: boolean, error?: string, validation = false): string {
  if (validation) return success ? 'passed' : error ? 'blocked' : 'pending'
  return success ? 'passed' : error ? 'blocked' : 'pending'
}

function shortRole(roleType: string): string {
  return roleType === 'controller'
    ? 'CTRL'
    : roleType === 'architect'
      ? 'ARCH'
      : roleType === 'developer'
        ? 'DEV'
        : roleType === 'reviewer'
          ? 'REV'
          : roleType === 'analyst'
            ? 'ANL'
            : roleType === 'tester'
              ? 'TST'
              : roleType.slice(0, 4).toUpperCase()
}

function assignedTaskRole(view: DashboardView, taskId: string, fallbackRole: string): string {
  return view.monitoring?.taskRows.find(row => row.taskId === taskId)?.roleType || fallbackRole
}

function shortStatus(status: string): string {
  return status === 'running'
    ? 'RUN'
    : status === 'completed'
      ? 'DONE'
      : status === 'failed'
        ? 'FAIL'
        : status === 'blocked'
          ? 'BLOCK'
          : status === 'ready'
            ? 'READY'
            : status === 'pending'
              ? 'WAIT'
              : status === 'reviewing'
                ? 'REVIEW'
                : status.toUpperCase()
}

function renderChecks(title: string, checks: Array<{ name: string; status: string; message: string; nextStep?: string; fixAction?: string; path?: string }>): string[] {
  if (checks.length === 0) return []
  const lines: string[] = []
  for (const check of checks) {
    lines.push(`${iconForState(check.status)} ${check.name} [${check.status}] ${check.message}`)
    if (check.path) lines.push(`    path: ${check.path}`)
    if (check.fixAction) lines.push(`    fix: ${check.fixAction}`)
    if (check.nextStep) lines.push(`    next: ${check.nextStep}`)
  }
  return renderSection(title, lines)
}

function latestProgressByTask(view: DashboardView): Map<string, ParallelProgressEvent> {
  const map = new Map<string, ParallelProgressEvent>()
  for (const event of view.recentProgress) {
    if (event.taskId) map.set(event.taskId, event)
  }
  return map
}

function renderControlSummary(view: DashboardView): string[] {
  const label = mergeLabel(view)
  return [
    `phase=${labelForPhase(view.phase)} governance=${view.governance.status}`,
    `tasks ready=${view.taskCounts.ready} running=${view.taskCounts.running} blocked=${view.taskCounts.blocked} done=${view.taskCounts.completed} fail=${view.taskCounts.failed}`,
    `${label}=${mergeStateText(view.merge.success, view.merge.error, label === 'validation')} telemetry=${view.telemetryCount}`,
  ]
}

function laneMarker(status: string): string {
  return status === 'running'
    ? '>>> '
    : status === 'failed'
      ? '!!! '
      : status === 'completed'
        ? 'OK  '
        : status === 'blocked'
          ? 'XX  '
          : '... '
}

export function renderMcpLaneSnapshot(view: DashboardView): string[] {
  const recentByTask = latestProgressByTask(view)
  return view.mcps.map(mcp => {
    const runningTask = mcp.assignedTasks.find(task => task.status === 'running')
    const queued = mcp.assignedTasks.filter(task => task.status === 'ready' || task.status === 'pending').length
    const done = mcp.assignedTasks.filter(task => task.status === 'completed').length
    const failed = mcp.assignedTasks.filter(task => task.status === 'failed').length
    const current = runningTask || mcp.assignedTasks[mcp.assignedTasks.length - 1]
    const currentStatus = runningTask?.status || current?.status || mcp.status
    const progress = current ? recentByTask.get(current.id) : undefined
    const roleLabel = current
      ? `${shortRole(mcp.roleType)}/${shortRole(assignedTaskRole(view, current.id, mcp.roleType))}`
      : shortRole(mcp.roleType)
    const headline = current
      ? `${current.id} ${compactText(current.title, 28)}`
      : 'idle'
    const detail = runningTask
      ? compactText(progress?.snippet || progress?.message || 'running', 42)
      : current
        ? compactText(`${shortStatus(current.status)}${failed ? ' needs-attn' : done ? ' finished' : ''}`, 42)
        : 'waiting for assignment'

    return `${laneMarker(currentStatus)}${mcp.id.padEnd(6)} ${roleLabel.padEnd(9)} ${headline.padEnd(38)} ${detail.padEnd(44)} q=${String(queued).padStart(2, ' ')} d=${String(done).padStart(2, ' ')} f=${String(failed).padStart(2, ' ')} ${mcp.activeModel}`
  })
}

export function renderProgressEvent(event: ParallelProgressEvent): string {
  const prefix = event.kind === 'controller'
    ? '[ctrl]'
    : event.kind === 'batch'
    ? '[batch]'
    : event.kind === 'task'
      ? '[task]'
      : event.kind === 'worker'
        ? '[mcp]'
        : event.kind === 'merge'
          ? '[merge]'
          : event.kind === 'recovery'
            ? '[recovery]'
            : '[session]'
  const message = `${iconForState(event.status || 'running')} ${event.message}`
  const parts = [prefix, message]
  if (event.snippet && !message.includes(event.snippet)) parts.push(`| ${event.snippet}`)
  if (event.durationMs !== undefined) parts.push(`| ${event.durationMs}ms`)
  return parts.join(' ')
}

export function renderProgressFocus(view: DashboardView): string[] {
  const active = view.activeTasks.length
    ? view.activeTasks.map(task => `run ${task.taskId} @ ${task.mcpId} | ${compactText(task.title, 28)} | ${compactText(task.lastProgressMessage, 42)}`)
    : ['idle | no MCP is currently running a task']
  const recent = view.recentProgress.length
    ? view.recentProgress.slice(-5).map(renderProgressEvent)
    : ['✅ none']
  return [
    ...renderSection('Control Summary', renderControlSummary(view)),
    ...renderSection('MCP Lanes', renderMcpLaneSnapshot(view)),
    ...renderSection('Active Focus', active),
    ...renderSection('Recent Progress', recent),
  ]
}

function shouldKeepProgressEvent(previous: ParallelProgressEvent | undefined, current: ParallelProgressEvent): boolean {
  if (!previous) return true
  return !(
    previous.kind === current.kind
    && previous.status === current.status
    && previous.taskId === current.taskId
    && previous.mcpId === current.mcpId
    && previous.message === current.message
    && previous.snippet === current.snippet
  )
}

export function renderProgressLog(events: ParallelProgressEvent[], limit = 14): string[] {
  const filtered = events.reduce<ParallelProgressEvent[]>((list, event) => {
    if (shouldKeepProgressEvent(list[list.length - 1], event)) list.push(event)
    return list
  }, [])
  const tail = filtered.slice(-limit)
  if (tail.length === 0) return ['⏳ no progress events captured']
  const hidden = filtered.length - tail.length
  return [
    ...(hidden > 0 ? [`… ${hidden} earlier events hidden`] : []),
    ...tail.map(renderProgressEvent),
  ]
}

export function renderStartupFlow(flow: StartupFlowState): string {
  const requirementLines = flow.requirementDraft
    ? [
        `captured: ${flow.requirementDraft.capturedAt}`,
        `requirement: ${flow.requirementDraft.requirement}`,
        `⛔ Do NOT implement this requirement yourself. Call parallel_start now.`,
      ]
    : flow.canAcceptRequirement
      ? [flow.requirementPrompt || '已连接并可输入需求。', 'next: run parallel_requirement first, then run parallel_start.']
      : flow.developmentStatus === 'resumable'
        ? ['当前优先恢复已有 session，无需重新输入需求。', 'next: 运行 parallel_resume 或先看 parallel_dashboard。']
        : flow.developmentStatus === 'approval_required'
          ? ['当前已有待审批执行计划。', 'next: 运行 parallel_approve 进入主控执行，或先看 parallel_dashboard。']
          : ['当前还不能直接开始需求开发。', 'next: 先按 recommended tool 修复阻塞项。']

  const lines = [
    '🚀 Parallel Controller — Startup',
    divider(),
    '欢迎使用 MCP 多角色并行开发助手',
    '',
    '› Status',
    `  project: ${flow.discovery.initialized ? '✅' : '⚠️'} ${flow.projectRoot.slice(-40)}`,
    `  connection: ✅ ${flow.connectionStatus}`,
    `  development: ${statusIcon(flow.developmentStatus)} ${flow.developmentStatus} → ${flow.recommendedAction}`,
    `  git: ${flow.discovery.hasGit ? '✅' : '❌'} ${flow.discovery.hasGit ? 'detected' : 'missing'}`,
    `  stack: ${flow.discovery.stack.length > 0 ? '✅' : '⚠️'} ${joinList(flow.discovery.stack).slice(0, 40)}`,
    `  completeness: ${statusIcon(flow.completeness.status)} ${flow.completeness.summary.slice(0, 40)}`,
    `  requirement: ${flow.requirementDraft ? '✅ captured' : '⏳ missing'}`,
  ]

  if (flow.requirementAnalysis) {
    const a = flow.requirementAnalysis
    lines.push(
      '',
      '› Requirement Analysis',
      `  type: ${a.kind} | clarity: ${a.clarity} | risk: ${a.riskLevel}`,
      `  landing: ${joinList(a.likelyLandingZones).slice(0, 50)}`,
      `  roles: ${joinList(a.recommendedRoles)}`,
      ...(a.riskHints.length > 0 ? [`  risks: ${a.riskHints.join('; ').slice(0, 50)}`] : []),
    )
  }

  lines.push(
    '',
    '› Completeness',
    `  ${flow.completeness.summary}`,
    ...flow.completeness.areas.map(area => `  ${statusIcon(area.status)} ${area.key}: ${area.message.slice(0, 45)}`),
  )

  if (flow.completeness.hardBlockers.length > 0) {
    lines.push('', '› Hard Blockers', ...flow.completeness.hardBlockers.map(b => `  🚫 ${b}`))
  }
  if (flow.completeness.softGaps.length > 0) {
    lines.push('', '› Soft Gaps', ...flow.completeness.softGaps.map(g => `  ⚠️ ${g}`))
  }

  lines.push(
    '',
    '› Recommended Action',
    `  tool: ${flow.recommendedAction}`,
    `  why: ${flow.recommendedReason}`,
    `  next: ${joinList(flow.nextActions)}`,
    '',
    '› Available Entries',
  )

  const entryRows: Array<[string, { available: boolean; reason?: string }]> = [
    ['parallel_approve', flow.entries.approve],
    ['parallel_start', flow.entries.newSession],
    ['parallel_resume', flow.entries.resume],
    ['template', flow.entries.template],
  ]
  for (const [name, entry] of entryRows) {
    lines.push(`  ${entry.available ? '✅' : '⛔'} ${name}${entry.available ? '' : ` (${(entry.reason || 'unavailable').slice(0, 30)})`}`)
  }

  lines.push('', '› Requirement', ...requirementLines.map(l => `  ${l}`))

  if (flow.recentSessions.length > 0) {
    lines.push('', '› Recent Sessions')
    for (const s of flow.recentSessions.slice(0, 4)) {
      lines.push(`  ${iconForState(s.resumable ? 'ready' : s.phase)} ${s.sessionId.slice(0, 14)} ${s.phase} ${compactText(s.requirement, 30)}${s.resumable ? ' [resumable]' : ''}`)
    }
  }

  lines.push(
    '',
    '› Steps',
    ...flow.steps.map(step => `  ${statusIcon(step.status)} ${step.title}${step.nextStep ? ` → ${step.nextStep}` : ''}`),
  )

  return lines.join('\n')
}

export function renderStartupRecommendations(flow: StartupFlowState): string[] {
  return [
    flow.summary,
    `connection: ${flow.connectionStatus}`,
    `development: ${flow.developmentStatus}`,
    `completeness: ${flow.completeness.status}`,
    `requirement: ${flow.requirementDraft ? 'captured' : 'missing'}`,
    ...(flow.requirementAnalysis
      ? [
          `analysis: ${flow.requirementAnalysis.kind} | landing=${joinList(flow.requirementAnalysis.likelyLandingZones)} | risk=${flow.requirementAnalysis.riskLevel}`,
        ]
      : []),
    `recommended tool: ${flow.recommendedAction}`,
    `why: ${flow.recommendedReason}`,
    `next: ${joinList(flow.nextActions)}`,
  ]
}

function renderRecentSessions(flow: StartupFlowState): string[] {
  if (flow.recentSessions.length === 0) return ['✅ none']
  return flow.recentSessions.slice(0, 4).map(item => `${iconForState(item.resumable ? 'ready' : item.phase)} ${item.sessionId} | ${compactText(item.requirement, 34)} | phase=${item.phase}${item.resumable ? ' | resumable' : ''}`)
}

function renderStartupTemplates(flow: StartupFlowState): string[] {
  if (flow.templates.length === 0) return ['✅ none']
  return flow.templates.slice(0, 4).map(item => `${item.id} | ${item.title} | ${compactText(item.description, 44)}`)
}

function renderStartupCompleteness(flow: StartupFlowState): string[] {
  return [
    flow.completeness.summary,
    `status: ${flow.completeness.status}`,
    `hard blockers: ${joinList(flow.completeness.hardBlockers)}`,
    `soft gaps: ${joinList(flow.completeness.softGaps)}`,
    `suggestions: ${joinList(flow.completeness.suggestions)}`,
    ...flow.completeness.areas.map(area => `${area.key} | ${area.status} | ${area.message}`),
  ]
}

function renderStartupRequirementAnalysis(flow: StartupFlowState): string[] {
  if (!flow.requirementDraft) return ['⏳ no requirement captured']
  if (!flow.requirementAnalysis) return ['⚠️ requirement captured but analysis is unavailable']
  return [
    `kind: ${flow.requirementAnalysis.kind}`,
    `controller: ${flow.requirementAnalysis.controllerSummary}`,
    `landing zones: ${joinList(flow.requirementAnalysis.likelyLandingZones)}`,
    `recommended roles: ${joinList(flow.requirementAnalysis.recommendedRoles)}`,
    `parallelism: ${flow.requirementAnalysis.estimatedParallelism}`,
    `execution lanes: ${flow.requirementAnalysis.recommendedExecutionLaneCount}`,
    `total MCPs: ${flow.requirementAnalysis.recommendedTotalMcpCount}`,
    `decomposition: ${flow.requirementAnalysis.decompositionStrategy}`,
    `clarity: ${flow.requirementAnalysis.clarity}`,
    `clarity hints: ${joinList(flow.requirementAnalysis.clarityHints)}`,
    `risk: ${flow.requirementAnalysis.riskLevel}`,
    `risk hints: ${joinList(flow.requirementAnalysis.riskHints)}`,
  ]
}

function renderPlanningAnalysis(view: DashboardView): string[] {
  const analysis = view.planning
  return [
    `kind: ${analysis.kind}`,
    `controller: ${analysis.controllerSummary}`,
    `landing zones: ${joinList(analysis.likelyLandingZones)}`,
    `recommended roles: ${joinList(analysis.recommendedRoles)}`,
    `parallelism: ${analysis.estimatedParallelism}`,
    `execution lanes: ${analysis.recommendedExecutionLaneCount}`,
    `total MCPs: ${analysis.recommendedTotalMcpCount}`,
    `decomposition: ${analysis.decompositionStrategy}`,
    `clarity: ${analysis.clarity}`,
    `clarity hints: ${joinList(analysis.clarityHints)}`,
    `risk: ${analysis.riskLevel}`,
    `risk hints: ${joinList(analysis.riskHints)}`,
  ]
}

function renderReassignmentSummary(view: DashboardView): string[] {
  if (view.reassignmentHistory.length === 0) return ['✅ none']
  return view.reassignmentHistory.slice(-6).map(item => `${item.taskId} | ${item.fromMcpId} -> ${item.toMcpId} | ${compactText(item.reason, 52)}`)
}

function renderPreflightCompleteness(completeness: ProjectCompletenessReport): string[] {
  return [
    completeness.summary,
    `status: ${completeness.status}`,
    `hard blockers: ${joinList(completeness.hardBlockers)}`,
    `soft gaps: ${joinList(completeness.softGaps)}`,
    `suggestions: ${joinList(completeness.suggestions)}`,
    ...completeness.areas.map(area => `${area.key} | ${area.status} | ${area.message}`),
  ]
}

function renderPreflightRecommendations(
  config: ProjectConfigReport,
  preflight: PreflightReport,
  completeness: ProjectCompletenessReport
): string[] {
  const attention = !config.passed || !preflight.passed || completeness.status === 'blocked'
  const canStart = config.passed && preflight.passed && completeness.status !== 'blocked'
  const next = attention
    ? 'fix failed checks / hard blockers, then rerun parallel_preflight'
    : completeness.status === 'warning'
      ? 'project can proceed, but fill soft gaps before broad multi-role dispatch'
      : 'run parallel_requirement or parallel_startup to continue controller planning'

  return [
    attention
      ? '当前仍有阻塞项，建议先补齐环境、配置或关键模块。'
      : canStart
        ? '当前 preflight 与完整度检查已达到可继续状态。'
        : '当前建议先处理提示项后再继续。',
    `config: ${config.passed ? 'passed' : 'attention'}`,
    `runtime: ${preflight.passed ? 'passed' : 'attention'}`,
    `completeness: ${completeness.status}`,
    `next: ${next}`,
  ]
}

export function renderPreflight(config: ProjectConfigReport, preflight: PreflightReport, completeness: ProjectCompletenessReport): string {
  const lines = [
    '🩺 Parallel Preflight',
    divider(),
    '',
    '› Checks',
  ]
  for (const check of [...config.checks, ...preflight.checks]) {
    lines.push(`  ${statusIcon(check.status)} ${check.name}: ${(check.message || '').slice(0, 45)}`)
  }

  lines.push('', '› Completeness', `  ${completeness.summary}`)
  for (const area of completeness.areas) {
    lines.push(`  ${statusIcon(area.status)} ${area.key}: ${area.message.slice(0, 45)}`)
  }

  if (completeness.hardBlockers.length > 0) {
    lines.push('', '› Hard Blockers', ...completeness.hardBlockers.map(b => `  🚫 ${b}`))
  }
  if (completeness.softGaps.length > 0) {
    lines.push('', '› Soft Gaps', ...completeness.softGaps.map(g => `  ⚠️ ${g}`))
  }
  if (completeness.suggestions.length > 0) {
    lines.push('', '› Suggestions', ...completeness.suggestions.map(s => `  💡 ${s}`))
  }

  const canStart = config.passed && preflight.passed && completeness.status !== 'blocked'
  lines.push(
    '',
    '› Recommendation',
    canStart ? '  ✅ 环境就绪，可以继续主控流程。' : '  ⚠️ 存在阻塞项，建议先修复。',
    `  config: ${config.passed ? 'passed' : 'attention'} | runtime: ${preflight.passed ? 'passed' : 'attention'} | completeness: ${completeness.status}`,
    `  next: ${canStart ? 'parallel_requirement or parallel_startup' : 'fix blockers, then rerun parallel_preflight'}`,
  )

  return lines.join('\n')
}

function renderCompactMergeBlock(input: {
  success?: boolean
  order?: string[]
  merged?: string[]
  failed?: Array<{ branch: string; error?: string }>
  conflicts?: string[]
  error?: string
}, label = 'merge'): string[] {
  const validation = label === 'validation'
  const state = mergeStateText(input.success, input.error, validation)
  return [
    `${iconForState(input.success ? 'passed' : 'failed')} ${label}=${state} order=${joinList(input.order || [])}`,
    `merged=${joinList(input.merged || [])}`,
    `failed=${(input.failed || []).map(item => `${item.branch}${item.error ? `(${compactText(item.error, 24)})` : ''}`).join(', ') || 'none'}`,
    `conflicts=${joinList(input.conflicts || [])}`,
    `error=${input.error || 'none'}`,
  ]
}

function renderCompactRecoveryBlock(items: Array<{ step: string; action?: string; suggestion?: string; status?: string }>, limit = 4): string[] {
  if (items.length === 0) return ['✅ none']
  return items.slice(-limit).map(item => `${iconForState(item.status || 'warning')} ${item.step}${item.action ? `/${item.action}` : ''} | ${compactText(item.suggestion || item.status || 'none', 72)}`)
}

function renderCompactBlockedBlock(items: Array<{ id: string; title: string; reasons: string[] }>): string[] {
  if (items.length === 0) return ['✅ none']
  return items.map(item => `${iconForState('blocked')} ${item.id} | ${compactText(item.title, 26)} | ${joinList(item.reasons)}`)
}

function renderCompactMcpNodeBlock(view: DashboardView): string[] {
  const busy = view.mcps.filter(mcp => mcp.assignedTasks.some(task => task.status === 'running')).length
  const failed = view.mcps.filter(mcp => mcp.assignedTasks.some(task => task.status === 'failed')).length
  const idle = view.mcps.length - busy
  return [
    `busy=${busy} idle=${idle} failed=${failed}`,
    ...view.mcps.slice(0, 6).map(mcp => {
      const running = mcp.assignedTasks.find(task => task.status === 'running')
      const current = running || mcp.assignedTasks[mcp.assignedTasks.length - 1]
      return `${iconForState(running ? 'running' : current?.status || mcp.status)} ${mcp.id} ${shortRole(mcp.roleType)} ${current ? compactText(`${current.id} ${current.title}`, 42) : 'idle'}`
    }),
  ]
}

export function renderDashboard(view: DashboardView): string {
  const label = mergeLabel(view)

  const lines = [
    '📊 Parallel Dashboard',
    divider(),
    `session: ${view.sessionId.slice(0, 18)} | phase: ${statusIcon(view.phase)} ${labelForPhase(view.phase)}`,
    `controller: ${view.controller}`,
    `tasks: ${view.taskCounts.running} running, ${view.taskCounts.completed} done, ${view.taskCounts.failed} failed, ${view.taskCounts.blocked} blocked`,
    `quality: ${view.qualityGate?.passed ? '✅ passed' : '❌ failed'} | ${label}: ${mergeStateText(view.merge.success, view.merge.error, label === 'validation')}`,
    '',
    `📌 ${view.summary.headline}`,
    `requirement: ${compactText(view.startup.requirement, 60)}`,
    `next: ${view.summary.nextAction}`,
    ...(view.summary.blockers.length > 0 ? view.summary.blockers.map(item => `⛔ ${compactText(item, 60)}`) : []),
    '',
    '› MCP Lanes',
  ]

  for (const mcp of view.mcps) {
    const taskSummary = mcp.assignedTasks.map(t => `${t.id}:${statusIcon(t.status)}`).join(' ')
    const reassignCount = mcp.assignedTasks.reduce((n, t) => n + (t.reassignmentCount || 0), 0)
    lines.push(`  ${iconForState(mcp.status)} ${mcp.id} ${shortRole(mcp.roleType)} ${mcp.activeModel.slice(0, 10)} | ${taskSummary.slice(0, 30)}${reassignCount > 0 ? ` | ${reassignCount}x reassign` : ''}`)
  }

  if (view.reassignmentHistory.length > 0) {
    lines.push('', '› Reassignments')
    for (const r of view.reassignmentHistory.slice(-6)) {
      lines.push(`  ${r.taskId} ${r.fromMcpId}→${r.toMcpId} ${compactText(r.reason, 40)}`)
    }
  }

  if (view.blockedTasks.length > 0) {
    lines.push(...renderCompactSection('Blocked Tasks', renderCompactBlockedBlock(view.blockedTasks)))
  }

  if (view.recoverySuggestions.length > 0) {
    lines.push(...renderCompactSection('Recovery', renderCompactRecoveryBlock(view.recoverySuggestions)))
  }

  // Merge
  const mergeBlock = renderCompactMergeBlock(view.merge, label)
  if (mergeBlock.length > 0) {
    lines.push('', `› ${label === 'validation' ? 'Validation Outcome' : 'Merge'}`)
    lines.push(...mergeBlock.map(l => `  ${l}`))
  }

  return lines.join('\n')
}

function renderHeaderSummary(summary: Array<[string, string | number | boolean | undefined]>): string[] {
  const filtered = summary.filter(([, value]) => value !== undefined)
  if (filtered.length === 0) return []
  const priority = ['session', 'controller', 'governance', 'phase', 'running', 'completed', 'failed', 'blocked', 'validation', 'merge', 'quality', 'contract gate', 'workspaces']
  const order = new Map(priority.map((key, index) => [key, index]))
  const sorted = [...filtered].sort(([left], [right]) => {
    const leftRank = order.get(left) ?? priority.length
    const rightRank = order.get(right) ?? priority.length
    return leftRank - rightRank || left.localeCompare(right)
  })
  const limited = sorted.slice(0, 8)
  const chunks: string[] = []
  for (let index = 0; index < limited.length; index += 4) {
    chunks.push(limited.slice(index, index + 4).map(([key, value]) => `${key}=${String(value)}`).join(' | '))
  }
  return chunks
}

function renderExecutionMonitoring(report: ExecutionSummaryReport): string[] {
  return [
    `total duration=${report.totalDurationMs}ms`,
    `total tokens=${report.totalTokens}`,
    `telemetry=${report.telemetryCount || 0} warnings=${report.warningCount || 0} failures=${report.failureCount || 0}`,
  ]
}

function renderPlanningReadiness(view: DashboardView): string[] {
  return [
    `config: ${view.startup.config.passed ? 'passed' : 'attention'}`,
    `preflight: ${view.preflight?.passed ? 'passed' : 'attention'}`,
    `completeness: ${view.startup.completeness.status}`,
    `hard blockers: ${joinList(view.startup.completeness.hardBlockers)}`,
    `soft gaps: ${joinList(view.startup.completeness.softGaps)}`,
    `suggestions: ${joinList(view.startup.completeness.suggestions)}`,
  ]
}

function renderPlanningCompleteness(view: DashboardView): string[] {
  return [
    view.startup.completeness.summary,
    ...view.startup.completeness.areas.map(area => `${area.key} | ${area.status} | ${area.message}`),
  ]
}

export function renderExecutionPlan(view: DashboardView): string {
  const totalTasks = view.taskCounts.pending + view.taskCounts.ready + view.taskCounts.running + view.taskCounts.blocked + view.taskCounts.reviewing + view.taskCounts.completed + view.taskCounts.failed

  const a = view.planning
  const lanePlanLines = view.controllerPlan.laneRoleRecommendations.map(lane => `  ${lane.roleType} × ${lane.count} — ${lane.reason}`)
  const controllerDecisionLines = view.controllerDecisions.slice(-6).map(decision => `  ${decision.type} | ${decision.summary.slice(0, 50)}`)

  const lines = [
    '⚠️ PLAN ONLY — Do NOT start coding. Call parallel_approve to begin.',
    '',
    '🧭 Parallel Execution Plan',
    divider(),
    `session: ${view.sessionId} | phase: ${labelForPhase(view.phase)}`,
    `controller: ${view.controller} | parallelism: ${view.controllerPlan.estimatedParallelism}`,
    `lanes: ${view.controllerPlan.recommendedExecutionLaneCount} (actual: ${view.laneStates.filter(lane => lane.roleType !== 'controller').length}) | MCPs: ${view.controllerPlan.recommendedTotalMcpCount}`,
    `tasks: ${totalTasks} | completeness: ${view.startup.completeness.status}`,
    '',
    '› Analysis',
    `  type: ${a.kind} | clarity: ${a.clarity} | risk: ${a.riskLevel}`,
    `  landing: ${joinList(a.likelyLandingZones).slice(0, 50)}`,
    `  roles: ${joinList(a.recommendedRoles)}`,
    '',
    '› Controller Plan',
    `  ${view.controllerPlan.summary}`,
    `  strategy: ${view.controllerPlan.decompositionStrategy}`,
    ...view.controllerPlan.reasoning.map(line => `  - ${line}`),
    '',
    '› Lane Roster',
    ...(lanePlanLines.length > 0 ? lanePlanLines : ['  no lane recommendations']),
    '',
    `› Requirement: ${compactText(view.startup.requirement, 55)}`,
    '',
    '› Tasks',
  ]

  for (const mcp of view.mcps) {
    for (const task of mcp.assignedTasks) {
      lines.push(`  ${statusIcon(task.status)} ${task.id} ${mcp.id} ${shortRole(mcp.roleType)} ${compactText(task.title, 35)}`)
    }
  }

  lines.push(
    '',
    '› Controller Decisions',
    ...(controllerDecisionLines.length > 0 ? controllerDecisionLines : ['  no decisions recorded']),
    '',
    `› Governance: ${view.governance.status} | contracts: ${view.contracts.length} | reviews: ${view.reviewAssignments.length}`,
    '',
    '→ Call parallel_approve to begin execution.',
  )

  return lines.join('\n')
}

export function renderControlExecution(options: {
  title: string
  view: DashboardView
  progressEvents: ParallelProgressEvent[]
  report: ExecutionSummaryReport
  workspaceIssues?: string[]
  nextStep: string
}): string {
  const label = mergeLabel(options.view)
  const lines = [
    options.title,
    divider(),
    ...renderHeaderSummary([
      ['session', options.view.sessionId],
      ['phase', labelForPhase(options.view.phase)],
      ['controller', options.view.controller],
      ['running', options.view.taskCounts.running],
      ['completed', options.view.taskCounts.completed],
      ['failed', options.view.taskCounts.failed],
      ['blocked', options.view.taskCounts.blocked],
      ['tokens', options.report.totalTokens],
    ]),
    ...renderCompactSection('Execution Summary', [
      options.view.summary.headline,
      `requirement: ${compactText(options.view.startup.requirement, 88)}`,
      ...renderExecutionMonitoring(options.report),
    ]),
    ...renderCompactSection('Planning Analysis', renderPlanningAnalysis(options.view)),
    ...renderCompactSection('Reassignments', renderReassignmentSummary(options.view)),
    ...renderProgressFocus(options.view),
    ...renderCompactSection('Progress Log', renderProgressLog(options.progressEvents)),
    ...renderCompactSection('MCP Metrics', options.report.rows.map(row => `${iconForState(row.progressStatus)} ${row.mcpId} [${row.roleName}] duration=${row.durationMs}ms tokens=${row.totalTokens} model=${row.activeModel} | ${compactText(row.workContent, 88)}`)),
    ...renderCompactSection('Task Metrics', (options.report.monitoring?.taskRows || []).map(row => `${iconForState(row.status)} ${row.taskId} | task-role=${row.roleType} | lane=${row.assignedMcpId || 'none'} | duration=${row.durationMs}ms | tokens=${row.totalTokens} | ${compactText(row.title, 60)}`)),
    ...renderCompactSection(label === 'validation' ? 'Validation Outcome' : 'Merge', renderCompactMergeBlock(options.view.merge, label)),
    ...renderCompactSection('Workspace State', [options.workspaceIssues?.join(', ') || 'clean']),
    ...renderCompactSection('Next Step', [options.nextStep]),
  ]
  return lines.join('\n')
}

export function renderExecutionReport(report: ExecutionSummaryReport): string {
  const validation = isReadOnlyValidationText(report.requirement || '')
  const label = validation ? 'validation' : 'merge'
  const state = mergeStateText(report.merge.success, report.merge.error, validation)
  const lines = [
    '🧾 Parallel Report',
    divider(),
    ...linesFromPairs([
      ['session', report.sessionId],
      ['governance', report.governanceStatus || 'pending'],
      ['config', report.startup?.configPassed ? 'passed' : 'attention'],
      ['completeness', report.startup?.completeness.status || 'unknown'],
      ['duration', report.totalDurationMs],
      ['tokens', report.totalTokens],
      ['telemetry', report.telemetryCount || 0],
      ['warnings', report.warningCount || 0],
      ['failures', report.failureCount || 0],
      ['completed', report.completedCount],
      ['failed', report.failedCount],
      ['blocked', report.blockedCount],
    ]),
    ...renderSection('Outcome Summary', [
      report.failedCount > 0
        ? `当前 session 有 ${report.failedCount} 个失败任务，需要优先关注。`
        : report.blockedCount > 0
          ? `当前 session 有 ${report.blockedCount} 个阻塞任务，建议先处理阻塞。`
          : `当前 session 已输出可总结结果，适合继续复盘或收尾。`,
      `next: ${report.failedCount > 0 || report.blockedCount > 0 ? 'parallel_dashboard' : 'review current result / archive report'}`,
    ]),
    ...renderSection('Readiness', [
      `config: ${report.startup?.configPassed ? 'passed' : 'attention'}`,
      `completeness: ${report.startup?.completeness.status || 'unknown'}`,
      `hard blockers: ${joinList(report.startup?.completeness.hardBlockers || [])}`,
      `soft gaps: ${joinList(report.startup?.completeness.softGaps || [])}`,
      `suggestions: ${joinList(report.startup?.completeness.suggestions || [])}`,
    ]),
    ...renderSection('Planning Analysis', report.startup?.planning
      ? [
          `kind: ${report.startup.planning.kind}`,
          `landing zones: ${joinList(report.startup.planning.likelyLandingZones)}`,
          `recommended roles: ${joinList(report.startup.planning.recommendedRoles)}`,
          `clarity: ${report.startup.planning.clarity}`,
          `clarity hints: ${joinList(report.startup.planning.clarityHints)}`,
          `risk: ${report.startup.planning.riskLevel}`,
          `risk hints: ${joinList(report.startup.planning.riskHints)}`,
        ]
      : ['✅ none']),
    ...renderSection('Project Completeness', report.startup?.completeness
      ? [
          report.startup.completeness.summary,
          ...report.startup.completeness.areas.map(area => `${area.key} | ${area.status} | ${area.message}`),
        ]
      : ['✅ none']),
    ...renderSection(validation ? 'Validation Outcome' : 'Merge', [
      `${iconForState(report.merge.success ? 'passed' : 'failed')} ${label}: ${state}`,
      `order: ${joinList(report.merge.order)}`,
      `merged: ${joinList(report.merge.merged)}`,
      `failed: ${report.merge.failed.map(item => `${item.branch}${item.error ? `(${item.error})` : ''}`).join(', ') || 'none'}`,
      `conflicts: ${joinList(report.merge.conflicts)}`,
      `error: ${report.merge.error || 'none'}`,
    ]),
    ...renderSection('Task Monitoring', (report.monitoring?.taskRows || []).map(row => `${iconForState(row.status)} ${row.taskId} ${row.title} | role=${row.roleType} | status=${row.status} | governance=${row.governanceStatus || 'pending'} | mcp=${row.assignedMcpId || 'none'} | duration=${row.durationMs} | tokens=${row.totalTokens}`)),
    ...renderSection('MCP Rows', report.rows.map(row => `${iconForState(row.progressStatus)} ${row.mcpId} [${row.roleName}] ${row.progressStatus} | duration=${row.durationMs} | tokens=${row.totalTokens} | model=${row.activeModel} | work=${row.workContent}`)),
  ]
  return lines.join('\n')
}

export function renderSessionOutcome(options: {
  action: 'started' | 'resumed' | 'blocked'
  sessionId: string
  phase: string
  summary: Array<[string, string | number | boolean | undefined]>
  sections?: Array<{ title: string; lines: string[] }>
  nextStep?: string
}): string {
  const title = options.action === 'started'
    ? '🚀 Parallel Session Started'
    : options.action === 'resumed'
      ? '🔁 Parallel Session Resumed'
      : '❌ Parallel Session Blocked'

  const lines = [
    title,
    divider(),
    `session=${options.sessionId} | phase=${options.phase}`,
    ...renderHeaderSummary(options.summary),
  ]

  for (const section of options.sections || []) {
    lines.push(...renderCompactSection(section.title, section.lines))
  }

  if (options.nextStep) {
    lines.push(...renderCompactSection('Next Step', [options.nextStep]))
  }

  return lines.join('\n')
}

const MSG_ICONS: Record<string, string> = { assign: '📋', ack: '✅', progress: '🔄', result: '📦', reassign: '🔀' }
const MSG_LABELS: Record<string, string> = { assign: '分配任务', ack: '确认', progress: '进度', result: '结果', reassign: '转派' }
const MSG_SEP = '────────────────────────────────────────'

export function renderMcpMessages(mcpId: string, messages: McpMessage[]): string {
  const related = messages.filter(m => m.from === mcpId || m.to === mcpId).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  if (related.length === 0) {
    return [uiHeader('💬', `${mcpId} 对话记录`), '', '  暂无对话记录。'].join('\n')
  }
  const lines = [uiHeader('💬', `${mcpId} 对话记录`), '']
  for (const m of related) {
    const time = m.timestamp.replace('T', ' ').slice(11, 19)
    const icon = MSG_ICONS[m.type] || '💬'
    const label = MSG_LABELS[m.type] || m.type
    lines.push(`  [${time}] ${m.from} → ${m.to}  ${icon} ${label}`)
    lines.push(`  ${m.content}`)
    if (m.durationMs || m.tokens) {
      const parts: string[] = []
      if (m.durationMs) parts.push(`耗时 ${m.durationMs}ms`)
      if (m.tokens) parts.push(`tokens ${m.tokens}`)
      lines.push(`  ${parts.join(' | ')}`)
    }
    lines.push(`  ${MSG_SEP}`)
    lines.push('')
  }
  lines.push(`  共 ${related.length} 条消息`)
  return lines.join('\n')
}
