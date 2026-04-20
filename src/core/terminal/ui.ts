import Table from 'cli-table3'
import type { ContextIndex, ExecutionSession, ExecutionSummaryReport, ParallelProgressEvent, TaskContextSnapshot } from '../../types.js'

const TABLE_CHARS = {
  'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
  'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
  'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
  'right': '│', 'right-mid': '┤', 'middle': '│',
}
const STYLE = { head: [] as string[], border: [] as string[] }
const W = 88
const LINE = '━'.repeat(W)

function pad(text: string, width: number): string {
  const len = [...text].length
  return len >= width ? text : text + ' '.repeat(width - len)
}

function box(title: string, lines: string[]): string {
  const inner = W - 4
  const rows = [
    `┌${'─'.repeat(W - 2)}┐`,
    `│  ${pad(title, inner)}│`,
    `├${'─'.repeat(W - 2)}┤`,
    ...lines.map(l => `│  ${pad(l, inner)}│`),
    `└${'─'.repeat(W - 2)}┘`,
  ]
  return rows.join('\n')
}

function header(icon: string, title: string): string {
  return [LINE, `  ${icon}  ${title}`, LINE].join('\n')
}

function kvBlock(pairs: Array<[string, string | number]>): string {
  return pairs.map(([k, v]) => `  ${k.padEnd(11)}${v}`).join('\n')
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

function statusIcon(status: string): string {
  if (status === 'completed' || status === 'done') return '✅'
  if (status === 'failed') return '❌'
  if (status === 'running') return '🔄'
  if (status === 'blocked') return '⛔'
  return '⏳'
}

// ─── Execution Summary Table ─────────────────────────────

export function renderExecutionSummaryTable(report: ExecutionSummaryReport): string {
  const rows = report.rows.map(row => {
    const status = row.progressStatus.includes('completed') ? '✅'
      : row.progressStatus.includes('failed') ? '❌'
      : '⏳'
    return `${status} ${row.mcpId} ${row.roleName} | ${row.workContent.split('|')[0].trim().slice(0, 35)} | ${formatDuration(row.durationMs)} ${formatTokens(row.totalTokens)}t`
  })

  const mergeStatus = report.merge.success
    ? `✅ ${report.merge.merged.length} branches merged`
    : report.merge.error
      ? `❌ merge failed: ${report.merge.error}`
      : '⏳ no merge attempted'
  const mergeExtra: string[] = []
  if (report.merge.merged.length > 0) mergeExtra.push(`merged: ${report.merge.merged.join(', ')}`)
  if (report.merge.conflicts.length > 0) mergeExtra.push(`conflicts: ${report.merge.conflicts.join(', ')}`)

  return [
    '✅ Parallel Execution Complete',
    '',
    `session: ${report.sessionId}`,
    `duration: ${formatDuration(report.totalDurationMs)} | tokens: ${formatTokens(report.totalTokens)} | tasks: ${report.completedCount}/${report.completedCount + report.failedCount}`,
    '',
    ...rows,
    '',
    `merge: ${mergeStatus}`,
    ...mergeExtra,
  ].join('\n')
}

// ─── Real-time Progress Formatting ──────────────────────

export function shouldBroadcast(event: ParallelProgressEvent): boolean {
  if (event.kind === 'worker') return false
  if (event.kind === 'session' && !event.message.includes('phase')) return false
  return true
}

export function formatBatchDispatch(events: ParallelProgressEvent[], tasks: Array<{ id: string; title: string; assignedMcpId?: string; roleType: string }>): string {
  const dispatched = tasks.filter(t => t.assignedMcpId)
  if (dispatched.length === 0) return ''
  const inner = W - 6
  const lines = [
    `┌─ Batch ─${'─'.repeat(W - 12)}┐`,
    `│  🚀 dispatching ${dispatched.length} tasks${' '.repeat(inner - 22 - String(dispatched.length).length)}│`,
    ...dispatched.map(t => {
      const text = `${(t.assignedMcpId || '').padEnd(8)} ${t.roleType.padEnd(10)} → ${t.id}: ${t.title}`
      return `│  ${pad(text, inner)}│`
    }),
    `└${'─'.repeat(W - 2)}┘`,
  ]
  return lines.join('\n')
}

export function formatTaskProgress(event: ParallelProgressEvent): string {
  const icon = statusIcon(event.status || 'running')
  const mcpId = (event.mcpId || '').padEnd(8)
  const role = event.snippet ? `[${event.snippet}]`.padEnd(12) : ''
  const duration = event.durationMs ? ` │ ${formatDuration(event.durationMs)}` : ''
  const tokens = event.totalTokens ? ` │ ${formatTokens(event.totalTokens)}` : ''
  return `${icon} ${mcpId}${role}${event.message}${duration}${tokens}`
}

export function formatMergeProgress(event: ParallelProgressEvent): string {
  const icon = event.status === 'completed' || event.status === 'passed' ? '✅' : event.status === 'failed' ? '❌' : '🔀'
  return `${icon} ${event.message}`
}

export function formatControllerDecision(event: ParallelProgressEvent): string {
  const icon = event.status === 'reassigned'
    ? '🔀'
    : event.status === 'failed'
      ? '❌'
      : event.status === 'ready'
        ? '📬'
        : event.status === 'dispatching'
          ? '📋'
          : '🧠'
  const detail = event.snippet ? ` | ${event.snippet}` : ''
  return `${icon} ${event.message}${detail}`
}

// ─── Patch Output ────────────────────────────────────────

export function renderPatchHeader(options: {
  sessionId: string
  requirement: string
  targetMcpId: string
  targetRole: string
  originalTaskId: string
  newTaskId: string
  contexts: TaskContextSnapshot[]
}): string {
  const lines = [
    '🔧 Parallel Patch',
    '━'.repeat(52),
    `session: ${options.sessionId} (reopened)`,
    `patch: ${options.requirement.slice(0, 55)}`,
    `target: ${options.targetMcpId} [${options.targetRole}] ← ${options.originalTaskId}`,
    `new task: ${options.newTaskId}`,
  ]

  if (options.contexts.length > 0) {
    lines.push('', '📂 Loaded Context:')
    for (let i = 0; i < options.contexts.length; i++) {
      const ctx = options.contexts[i]
      const files = ctx.files.length > 1 ? `${ctx.files[0]} +${ctx.files.length - 1}` : ctx.files[0] || 'none'
      lines.push(`  ${i + 1}. ${ctx.mcpId}/${ctx.taskId} ${ctx.title.slice(0, 25)} [${files}]`)
    }
  }

  return lines.join('\n')
}

// ─── Context Cache Output ────────────────────────────────

export function renderContextList(entries: ContextIndex[]): string {
  if (entries.length === 0) {
    return [
      '📦 Context Cache',
      '',
      '  No snapshots found.',
      '  Snapshots are created automatically when tasks complete.',
    ].join('\n')
  }

  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const first = sorted[0].createdAt
  const last = sorted[sorted.length - 1].createdAt

  const lines = [
    '📦 Context Cache Timeline',
    '━'.repeat(52),
    `snapshots: ${entries.length} | span: ${first} → ${last}`,
    '',
  ]
  for (const entry of sorted) {
    lines.push(`${statusIcon(entry.status)} ${entry.createdAt.slice(11, 19)} ${entry.mcpId} ${entry.taskId} ${entry.title.slice(0, 25)} ${formatTokens(entry.tokens)}t`)
  }
  lines.push(
    '',
    'Usage:',
    '  parallel_context show <mcpId> <taskId>',
    '  parallel_context restore <timestamp>',
  )
  return lines.join('\n')
}

export function renderContextDetail(snapshot: TaskContextSnapshot): string {
  return [
    `📋 Context: ${snapshot.mcpId}/${snapshot.taskId}`,
    '━'.repeat(52),
    `role: ${snapshot.roleType} | status: ${statusIcon(snapshot.status)} ${snapshot.status}`,
    `title: ${snapshot.title}`,
    `time: ${snapshot.createdAt} | duration: ${formatDuration(snapshot.durationMs)} | tokens: ${formatTokens(snapshot.tokens)}`,
    `session: ${snapshot.sessionId}`,
    '',
    `› Files: ${snapshot.files.length > 0 ? snapshot.files.join(', ') : 'none'}`,
    `› Requirement: ${snapshot.requirement.slice(0, 60)}`,
    ...(snapshot.patchRequirement ? [`› Patch: ${snapshot.patchRequirement.slice(0, 60)}`] : []),
    '',
    '› Output:',
    ...snapshot.output.split('\n').slice(0, 12).map(l => `  ${l}`),
  ].join('\n')
}

export { formatDuration, formatTokens, statusIcon, header, kvBlock, box, LINE, W }

// ─── Live Worker Status Table ───────────────────────────

export interface WorkerLiveState {
  mcpId: string
  taskId: string
  roleType: string
  status: 'started' | 'running' | 'completed' | 'failed'
  startedAt: number
  snippet: string
  activeModel: string
  durationMs?: number
  totalTokens?: number
}

export function renderLiveWorkerTable(workers: Map<string, WorkerLiveState>): string {
  if (workers.size === 0) return ''

  const now = Date.now()
  const table = new Table({
    chars: TABLE_CHARS,
    head: ['MCP', 'Task', 'Status', 'Duration', 'Tokens', 'Latest'],
    colWidths: [10, 10, 10, 10, 10, 38],
    style: STYLE,
  })

  let totalTokens = 0
  for (const w of workers.values()) {
    const elapsed = w.durationMs ?? (now - w.startedAt)
    const tokens = w.totalTokens ?? 0
    totalTokens += tokens
    const icon = w.status === 'completed' ? '✅' : w.status === 'failed' ? '❌' : '🔄'
    table.push([
      w.mcpId,
      w.taskId,
      `${icon} ${w.status.slice(0, 5)}`,
      formatDuration(elapsed),
      tokens > 0 ? formatTokens(tokens) : '...',
      (w.snippet || '').slice(0, 34),
    ])
  }

  const running = [...workers.values()].filter(w => w.status === 'running' || w.status === 'started').length
  const done = [...workers.values()].filter(w => w.status === 'completed').length
  const failed = [...workers.values()].filter(w => w.status === 'failed').length

  return [
    `🔄 Workers: ${running} running, ${done} done, ${failed} failed | tokens: ${totalTokens > 0 ? formatTokens(totalTokens) : '...'}`,
    table.toString(),
  ].join('\n')
}

export function renderLiveControllerConsole(session: ExecutionSession): string {
  const decisions = [...(session.controllerDecisions || [])].slice(-6)
  const lanes = session.laneStates || []

  const decisionLines = decisions.length > 0
    ? decisions.map(item => `${item.timestamp.slice(11, 19)} ${item.summary}`.slice(0, W - 6))
    : ['waiting for controller decisions']

  const decisionBox = box('🧠 Controller Decisions', decisionLines)

  const laneTable = new Table({
    chars: TABLE_CHARS,
    head: ['MCP', 'Role', 'Task', 'Status', 'Elapsed', 'Tokens', 'Latest'],
    colWidths: [10, 12, 10, 10, 10, 10, 26],
    style: STYLE,
  })

  for (const lane of lanes) {
    laneTable.push([
      lane.mcpId,
      lane.roleType,
      lane.currentTaskId || '-',
      `${statusIcon(lane.status)} ${lane.status.slice(0, 5)}`,
      lane.currentElapsedMs ? formatDuration(lane.currentElapsedMs) : '-',
      lane.currentTokens ? formatTokens(lane.currentTokens) : '-',
      (lane.latestReply || '').slice(0, 22),
    ])
  }

  const running = lanes.filter(lane => lane.status === 'running').length
  const queue = lanes.reduce((sum, lane) => sum + lane.queueDepth, 0)
  const done = lanes.reduce((sum, lane) => sum + lane.completedTaskCount, 0)

  return [
    `🧠 Controller: ${running} running lanes | queue ${queue} | completed ${done}`,
    decisionBox,
    laneTable.toString(),
  ].join('\n')
}
