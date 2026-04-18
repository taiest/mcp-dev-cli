import type {
  ExecutionSummaryReport,
  ParallelProgressEvent,
  PreflightReport,
  ProjectConfigReport,
  SessionPhase,
  StartupFlowState,
} from '../../types.js'
import type { DashboardView } from '../report/dashboard-view.js'
import { isReadOnlyValidationText } from '../worker/validation-task.js'

function divider(char = '━', width = 52): string {
  return char.repeat(width)
}

function iconForState(status: string): string {
  if (['passed', 'completed', 'ready_for_merge', 'merged', 'success', 'available', 'ready'].includes(status)) return '✅'
  if (['warning', 'review_required', 'review_assigned', 'waiting_approval', 'running', 'reviewing', 'started', 'dispatching', 'merging', 'quality-gate'].includes(status)) return '⚠️'
  if (['failed', 'review_rejected', 'blocked'].includes(status)) return '❌'
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
  const prefix = event.kind === 'batch'
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
  const lines = [
    '🚀 Parallel Startup',
    divider(),
    ...linesFromPairs([
      ['project', flow.projectRoot],
      ['connection', flow.connectionStatus],
      ['development', flow.developmentStatus],
      ['recommended', flow.recommendedEntry],
      ['tool', flow.recommendedAction],
      ['git', flow.discovery.hasGit ? 'ready' : 'missing'],
      ['initialized', flow.discovery.initialized ? 'yes' : 'no'],
      ['stack', joinList(flow.discovery.stack)],
      ['recent sessions', flow.recentSessions.length],
      ['templates', flow.templates.length],
    ]),
    ...renderSection('What To Do Next', renderStartupRecommendations(flow)),
    ...renderSection('Requirement Input', flow.canAcceptRequirement
      ? [flow.requirementPrompt || '已连接并可输入需求。', 'next: 在对话框输入需求并回车，再调用 parallel_start。']
      : flow.developmentStatus === 'resumable'
        ? ['当前优先恢复已有 session，无需重新输入需求。', 'next: 运行 parallel_resume 或先看 parallel_dashboard。']
        : flow.developmentStatus === 'approval_required'
          ? ['当前已有待审批执行计划。', 'next: 运行 parallel_approve 进入主控执行，或先看 parallel_dashboard。']
          : ['当前还不能直接开始需求开发。', 'next: 先按 recommended tool 修复阻塞项。']),
    ...renderSection('Entries', [
      `${iconForState(flow.entries.approve.available ? 'ready' : 'warning')} approve: ${flow.entries.approve.available ? 'available' : flow.entries.approve.reason || 'unavailable'}`,
      `${iconForState(flow.entries.newSession.available ? 'ready' : 'warning')} new session: ${flow.entries.newSession.available ? 'available' : flow.entries.newSession.reason || 'unavailable'}`,
      `${iconForState(flow.entries.resume.available ? 'ready' : 'warning')} resume: ${flow.entries.resume.available ? 'available' : flow.entries.resume.reason || 'unavailable'}`,
      `${iconForState(flow.entries.template.available ? 'ready' : 'warning')} template: ${flow.entries.template.available ? 'available' : flow.entries.template.reason || 'unavailable'}`,
    ]),
    ...renderSection('Recent Sessions', renderRecentSessions(flow)),
    ...renderSection('Templates', renderStartupTemplates(flow)),
    ...renderSection('Startup Steps', flow.steps.map(step => `${iconForState(step.status)} ${step.title} [${step.status}] ${step.message}${step.nextStep ? ` | next: ${step.nextStep}` : ''}`)),
  ]
  return lines.join('\n')
}

export function renderStartupRecommendations(flow: StartupFlowState): string[] {
  return [
    flow.summary,
    `connection: ${flow.connectionStatus}`,
    `development: ${flow.developmentStatus}`,
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

function renderCompactSessionSummary(options: { headline: string; nextAction?: string; nextReason?: string; blockers?: string[] }): string[] {
  return [
    options.headline,
    ...(options.nextAction ? [`next: ${options.nextAction}${options.nextReason ? ` | ${options.nextReason}` : ''}`] : []),
    ...((options.blockers || []).length > 0 ? (options.blockers || []).map(item => `blocker: ${compactText(item, 72)}`) : []),
  ]
}

export function renderPreflight(config: ProjectConfigReport, preflight: PreflightReport): string {
  const lines = [
    '🩺 Parallel Preflight',
    divider(),
    ...linesFromPairs([
      ['config', config.passed ? 'passed' : 'attention'],
      ['preflight', preflight.passed ? 'passed' : 'attention'],
    ]),
    ...renderChecks('Config Checks', config.checks),
    ...renderChecks('Runtime Checks', preflight.checks),
  ]
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
    ...renderHeaderSummary([
      ['session', view.sessionId],
      ['phase', labelForPhase(view.phase)],
      ['controller', view.controller],
      ['governance', view.governance.status],
      ['running', view.taskCounts.running],
      ['completed', view.taskCounts.completed],
      ['failed', view.taskCounts.failed],
      ['blocked', view.taskCounts.blocked],
      ['quality', view.qualityGate?.passed ? 'passed' : 'failed'],
      ['contract gate', view.contractGate?.passed ? 'passed' : 'failed'],
      [label, mergeStateText(view.merge.success, view.merge.error, label === 'validation')],
      ['telemetry', view.telemetryCount],
    ]),
    ...renderCompactSection('What To Watch', [
      view.summary.headline,
      `requirement: ${compactText(view.startup.requirement, 72)}`,
      `assignments: ${view.summary.assignmentHeadline}`,
      `roles: ${view.summary.roleHeadline}`,
      `recent: ${compactText(view.summary.recentChange, 72)}`,
      `next: ${view.summary.nextAction} | ${view.summary.nextReason}`,
      ...(view.summary.blockers.length > 0 ? view.summary.blockers.map(item => `blocker: ${compactText(item, 72)}`) : ['blocker: none']),
    ]),
    ...renderCompactSection('Assignments', view.assignmentSummary.length > 0 ? view.assignmentSummary : ['✅ none']),
    ...renderCompactSection('Created Roles', view.createdRoles.length > 0
      ? view.createdRoles.map(role => `${role.mcpId} | .claude/agents/${role.file} | ${role.role} | ${role.tasks.join(', ') || 'waiting'}`)
      : ['✅ none']),
    ...renderProgressFocus(view),
    ...renderCompactSection(label === 'validation' ? 'Validation Outcome' : 'Merge', renderCompactMergeBlock(view.merge, label)),
    ...renderCompactSection('Blocked Tasks', renderCompactBlockedBlock(view.blockedTasks)),
    ...renderCompactSection('MCP Nodes', renderCompactMcpNodeBlock(view)),
    ...renderCompactSection('Recovery', renderCompactRecoveryBlock(view.recoverySuggestions)),
  ]
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

export function renderExecutionPlan(view: DashboardView): string {
  const lines = [
    '🧭 Parallel Execution Plan',
    divider(),
    ...renderHeaderSummary([
      ['session', view.sessionId],
      ['phase', labelForPhase(view.phase)],
      ['controller', view.controller],
      ['mcps', view.mcps.length],
      ['tasks', view.taskCounts.pending + view.taskCounts.ready + view.taskCounts.running + view.taskCounts.blocked + view.taskCounts.reviewing + view.taskCounts.completed + view.taskCounts.failed],
      ['contract gate', view.contractGate?.passed ? 'passed' : 'failed'],
      ['preflight', view.preflight?.passed ? 'passed' : 'failed'],
    ]),
    ...renderCompactSection('Plan Summary', [
      view.summary.headline,
      `requirement: ${compactText(view.startup.requirement, 88)}`,
      `next: parallel_approve | ${view.summary.nextReason}`,
    ]),
    ...renderCompactSection('Assignments', view.assignmentSummary.length > 0 ? view.assignmentSummary : ['✅ none']),
    ...renderCompactSection('Task Breakdown', view.taskCounts.pending + view.taskCounts.ready + view.taskCounts.running + view.taskCounts.blocked + view.taskCounts.reviewing + view.taskCounts.completed + view.taskCounts.failed > 0
      ? view.mcps.flatMap(mcp => mcp.assignedTasks.map(task => `${task.id} | ${mcp.id} [${shortRole(mcp.roleType)} → ${shortRole(assignedTaskRole(view, task.id, mcp.roleType))}] | ${task.status} | ${compactText(task.title, 60)}`))
      : ['✅ none']),
    ...renderCompactSection('Governance & Contracts', [
      `governance=${view.governance.status}`,
      `review assignments=${view.reviewAssignments.length}`,
      `contracts=${view.contracts.length}`,
      `contract gate=${view.contractGate?.passed ? 'passed' : 'failed'}`,
    ]),
    ...renderCompactSection('Approval', [
      '当前仅完成需求拆解、任务分配与执行计划生成。',
      '运行 parallel_approve 后才会创建角色文件、准备工作区并进入前台执行。',
    ]),
  ]
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
