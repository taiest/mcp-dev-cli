import Table from 'cli-table3'
import type { ContextIndex, ExecutionSummaryReport, ParallelProgressEvent, TaskContextSnapshot } from '../../types.js'

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
  const table = new Table({
    chars: TABLE_CHARS,
    head: ['MCP', 'Role', 'Task', 'Status', 'Duration', 'Tokens'],
    colWidths: [10, 11, 34, 10, 11, 10],
    style: STYLE,
  })

  for (const row of report.rows) {
    const status = row.progressStatus.includes('completed') ? '✅ done'
      : row.progressStatus.includes('failed') ? '❌ fail'
      : row.progressStatus
    table.push([
      row.mcpId,
      row.roleName,
      row.workContent.split('|')[0].trim().slice(0, 30),
      status,
      formatDuration(row.durationMs),
      formatTokens(row.totalTokens),
    ])
  }

  const totalTable = new Table({
    chars: { ...TABLE_CHARS, 'top-left': '├', 'top-right': '┤' },
    colWidths: [10, 11, 34, 10, 11, 10],
    style: STYLE,
  })
  totalTable.push([
    'TOTAL',
    '',
    `${report.completedCount + report.failedCount} tasks`,
    `${report.completedCount}/${report.completedCount + report.failedCount} ✅`,
    formatDuration(report.totalDurationMs),
    formatTokens(report.totalTokens),
  ])

  const mergeStatus = report.merge.success
    ? `✅ ${report.merge.merged.length} branches merged into main`
    : report.merge.error
      ? `❌ merge failed: ${report.merge.error}`
      : '⏳ no merge attempted'
  const mergeLines = [mergeStatus]
  if (report.merge.merged.length > 0) {
    mergeLines.push(`merged: ${report.merge.merged.join(', ')}`)
  }
  if (report.merge.conflicts.length > 0) {
    mergeLines.push(`conflicts: ${report.merge.conflicts.join(', ')}`)
  }

  return [
    header('✅', 'Parallel Execution Complete'),
    '',
    kvBlock([
      ['session', report.sessionId],
      ['duration', formatDuration(report.totalDurationMs)],
      ['tokens', formatTokens(report.totalTokens)],
      ['tasks', `${report.completedCount}/${report.completedCount + report.failedCount} completed`],
    ]),
    '',
    table.toString(),
    totalTable.toString(),
    '',
    box('🔀 Merge Result', mergeLines),
    '',
    box('🤖 主控 MCP-01', [
      '我是主控 MCP-01，以上是本轮完整执行结果。',
      '如果需要修改，请在下方对话框输入修改指令或需求，',
      '由我来重新分配执行。',
    ]),
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
  const tokens = ''
  return `${icon} ${mcpId}${role}${event.message}${duration}${tokens}`
}

export function formatMergeProgress(event: ParallelProgressEvent): string {
  const icon = event.status === 'completed' || event.status === 'passed' ? '✅' : event.status === 'failed' ? '❌' : '🔀'
  return `${icon} ${event.message}`
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
    header('🔧', 'Parallel Patch'),
    '',
    kvBlock([
      ['session', `${options.sessionId} (reopened)`],
      ['patch', options.requirement.slice(0, 60)],
      ['target', `${options.targetMcpId} [${options.targetRole}] ← owner of ${options.originalTaskId}`],
      ['new task', `${options.newTaskId} (appended to task graph)`],
    ]),
    '',
  ]

  if (options.contexts.length > 0) {
    const ctxTable = new Table({
      chars: TABLE_CHARS,
      head: ['#', 'MCP / Task', 'Time', 'Title', 'Files'],
      colWidths: [5, 18, 18, 30, 19],
      style: STYLE,
    })
    for (let i = 0; i < options.contexts.length; i++) {
      const ctx = options.contexts[i]
      const filesSummary = ctx.files.length > 1
        ? `${ctx.files[0]} +${ctx.files.length - 1}`
        : ctx.files[0] || 'none'
      ctxTable.push([
        String(i + 1),
        `${ctx.mcpId}/${ctx.taskId}`,
        ctx.createdAt,
        ctx.title.slice(0, 28),
        filesSummary.slice(0, 17),
      ])
    }
    lines.push('  📂 Loaded Context from Cache')
    lines.push(ctxTable.toString())
    lines.push('')
  }

  return lines.join('\n')
}

// ─── Context Cache Output ────────────────────────────────

export function renderContextList(entries: ContextIndex[]): string {
  if (entries.length === 0) {
    return [
      header('📦', 'Context Cache'),
      '',
      '  No snapshots found.',
      '',
      box('💡 Usage', [
        'Snapshots are created automatically when tasks complete.',
        'Run parallel_approve or parallel_patch to generate them.',
      ]),
    ].join('\n')
  }

  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const first = sorted[0].createdAt
  const last = sorted[sorted.length - 1].createdAt

  const table = new Table({
    chars: TABLE_CHARS,
    head: ['Time', 'MCP', 'Task', 'Title', 'Status', 'Tokens'],
    colWidths: [18, 10, 10, 28, 10, 10],
    style: STYLE,
  })

  for (const entry of sorted) {
    table.push([
      entry.createdAt,
      entry.mcpId,
      entry.taskId,
      entry.title.slice(0, 26),
      `${statusIcon(entry.status)} ${entry.status.slice(0, 4)}`,
      formatTokens(entry.tokens),
    ])
  }

  return [
    header('📦', 'Context Cache Timeline'),
    '',
    kvBlock([
      ['project', process.cwd()],
      ['snapshots', entries.length],
      ['span', `${first} → ${last}`],
    ]),
    '',
    table.toString(),
    '',
    box('💡 Usage', [
      'parallel_context show <mcpId> <taskId>     查看快照详情',
      'parallel_context restore <timestamp>        恢复到该时间点',
    ]),
  ].join('\n')
}

export function renderContextDetail(snapshot: TaskContextSnapshot): string {
  return [
    header('📋', `Context Detail: ${snapshot.mcpId}/${snapshot.taskId}`),
    '',
    kvBlock([
      ['mcp', snapshot.mcpId],
      ['task', snapshot.taskId],
      ['role', snapshot.roleType],
      ['title', snapshot.title],
      ['status', `${statusIcon(snapshot.status)} ${snapshot.status}`],
      ['time', snapshot.createdAt],
      ['duration', formatDuration(snapshot.durationMs)],
      ['tokens', formatTokens(snapshot.tokens)],
      ['session', snapshot.sessionId],
    ]),
    '',
    box('📁 Files', snapshot.files.length > 0 ? snapshot.files : ['none']),
    '',
    box('📝 Requirement', [snapshot.requirement.slice(0, 80)]),
    ...(snapshot.patchRequirement ? ['', box('🔧 Patch Requirement', [snapshot.patchRequirement.slice(0, 80)])] : []),
    '',
    box('📄 Output Summary', snapshot.output.split('\n').slice(0, 12)),
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
