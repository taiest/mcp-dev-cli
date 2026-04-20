import type { ExecutionSession, OrchestratedTask, WorkspaceDescriptor } from '../types.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { PolicyEngine } from '../core/policy/policy-engine.js'
import { buildWorkerPrompt } from '../core/worker/worker-prompt.js'
import { parseWorkspaceMap } from './foreground-execution.js'

type AgentLaunchModel = 'sonnet' | 'opus' | 'haiku'

function buildReviewContext(session: ExecutionSession): string {
  return session.taskGraph.tasks
    .filter(t => t.reviewRequired && t.status === 'completed')
    .map(t => {
      const output = (session.artifacts[`output:${t.id}`] || '').slice(0, 2000)
      return `${t.id} | ${t.title}\nstatus: ${t.status}\n${output}`
    })
    .join('\n\n---\n\n')
}

function toAgentLaunchModel(model: string): AgentLaunchModel {
  return model === 'opus' || model === 'haiku' || model === 'sonnet' ? model : 'sonnet'
}

function previewPrompt(prompt: string): string {
  return prompt.length <= 160 ? prompt : `${prompt.slice(0, 160)}…`
}

function indent(text: string, spaces = 2): string {
  const prefix = ' '.repeat(spaces)
  return text.split('\n').map(line => `${prefix}${line}`).join('\n')
}

export interface BatchTask {
  taskId: string
  mcpId: string
  roleType: string
  title: string
  prompt: string
  workspacePath: string
  launch: {
    description: string
    model: AgentLaunchModel
    runInBackground: true
    isolation: 'worktree'
  }
  reportBack: {
    tool: 'parallel_task_done'
    args: {
      taskId: string
      mcpId: string
      success: true
      output: '<fill with Agent result summary>'
      durationMs?: '<optional>'
      totalTokens?: '<optional>'
    }
  }
}

export interface NextBatchResult {
  executionMode: 'frontend-agent'
  tasks: BatchTask[]
  completed: number
  total: number
  pending: number
  blocked: number
  done: boolean
  instruction: string
}

export function renderNextBatch(result: NextBatchResult): string {
  const summary = [
    '🚀 Next Batch Ready',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `mode: ${result.executionMode}`,
    `progress: ${result.completed}/${result.total} completed | pending: ${result.pending} | blocked: ${result.blocked}`,
    `tasks ready now: ${result.tasks.length}`,
    '',
    result.instruction,
  ]

  if (result.tasks.length === 0) {
    return summary.join('\n')
  }

  const taskBlocks = result.tasks.map(task => [
    `${task.taskId} | ${task.mcpId} | ${task.roleType} | ${task.title}`,
    `workspace: ${task.workspacePath}`,
    `prompt preview: ${previewPrompt(task.prompt)}`,
    'launch:',
    indent(JSON.stringify(task.launch, null, 2), 2),
    'report back:',
    indent(JSON.stringify(task.reportBack, null, 2), 2),
  ].join('\n')).join('\n\n')

  return [
    ...summary,
    '',
    'Frontend Agent launch plan:',
    taskBlocks,
    '',
    'Raw JSON payload:',
    '```json',
    JSON.stringify(result, null, 2),
    '```',
  ].join('\n')
}

export async function getNextBatch(projectRoot: string): Promise<NextBatchResult> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) return { executionMode: 'frontend-agent', tasks: [], completed: 0, total: 0, pending: 0, blocked: 0, done: true, instruction: '没有活跃的 session。' }

  if (session.phase === 'planning') return { executionMode: 'frontend-agent', tasks: [], completed: 0, total: 0, pending: 0, blocked: 0, done: false, instruction: '当前 session 还在 planning 阶段，请先调用 parallel_approve。' }
  if (session.phase === 'completed') return { executionMode: 'frontend-agent', tasks: [], completed: 0, total: 0, pending: 0, blocked: 0, done: true, instruction: '当前 session 已完成。请调用 parallel_report 查看结果。' }

  const scheduler = new Scheduler()
  const policy = new PolicyEngine()
  const reconciled = scheduler.reconcile(session)
  runtime.save(reconciled)

  const workspaces = parseWorkspaceMap(reconciled.artifacts.workspaceMap)
  const context = reconciled.artifacts.contextSummary || ''
  const reviewContext = buildReviewContext(reconciled)

  const allTasks = reconciled.taskGraph.tasks
  const completed = allTasks.filter(t => t.status === 'completed').length
  const total = allTasks.length
  const pending = allTasks.filter(t => t.status === 'pending' || t.status === 'blocked').length
  const blocked = allTasks.filter(t => t.status === 'blocked').length
  const running = allTasks.filter(t => t.status === 'running').length

  const dispatchable = allTasks.filter(task => {
    if (task.status !== 'ready' || !task.assignedMcpId) return false
    const node = reconciled.mcps.find(m => m.id === task.assignedMcpId)
    if (!node) return false
    return node.status !== 'running' && node.status !== 'failed'
      && policy.canExecuteTask(node, task, reconciled.controllerMcpId)
  })

  if (dispatchable.length === 0 && running === 0) {
    return { executionMode: 'frontend-agent', tasks: [], completed, total, pending, blocked, done: true, instruction: '所有可执行任务已完成。请调用 parallel_finalize 进行合并和报告。' }
  }

  if (dispatchable.length === 0) {
    return { executionMode: 'frontend-agent', tasks: [], completed, total, pending, blocked, done: false, instruction: `当前有 ${running} 个任务正在执行中，等待完成后会解锁新任务。请在 Agent 完成后调用 parallel_task_done 回报结果。` }
  }

  // Mark dispatched tasks as running
  let updated = reconciled
  const batchTasks: BatchTask[] = []

  for (const task of dispatchable) {
    const node = updated.mcps.find(m => m.id === task.assignedMcpId)!
    const workspace = resolveWorkspace(task, updated, workspaces)
    if (!workspace) continue

    const prompt = buildWorkerPrompt(node, task, reconciled.contracts || [], context, task.roleType === 'reviewer' ? reviewContext : undefined)

    // Mark task running
    updated = {
      ...updated,
      taskGraph: {
        ...updated.taskGraph,
        tasks: updated.taskGraph.tasks.map(t => t.id === task.id ? { ...t, status: 'running' as const } : t),
      },
      mcps: updated.mcps.map(m => m.id === task.assignedMcpId ? { ...m, status: 'running' as const } : m),
    }

    batchTasks.push({
      taskId: task.id,
      mcpId: task.assignedMcpId!,
      roleType: task.roleType,
      title: task.title,
      prompt,
      workspacePath: workspace.path,
      launch: {
        description: `${task.assignedMcpId} ${task.title}`,
        model: toAgentLaunchModel(node.activeModel),
        runInBackground: true,
        isolation: 'worktree',
      },
      reportBack: {
        tool: 'parallel_task_done',
        args: {
          taskId: task.id,
          mcpId: task.assignedMcpId!,
          success: true,
          output: '<fill with Agent result summary>',
        },
      },
    })
  }

  runtime.save(updated)

  const instruction = [
    `请在 Claude Code 前端并行启动以下 ${batchTasks.length} 个 Agent。`,
    '每个 Agent 使用 task.prompt 作为提示词，并套用 task.launch 中的启动参数。',
    '每个 Agent 完成后，调用 parallel_task_done，并优先使用 task.reportBack 作为回报模板。',
    '所有任务完成后，调用 parallel_next_batch 检查是否有新解锁的任务。',
  ].join('\n')

  return { executionMode: 'frontend-agent', tasks: batchTasks, completed, total, pending, blocked, done: false, instruction }
}

function resolveWorkspace(
  task: OrchestratedTask,
  session: ExecutionSession,
  workspaces: Record<string, WorkspaceDescriptor>,
): WorkspaceDescriptor | undefined {
  if (task.roleType !== 'reviewer') {
    return task.assignedMcpId ? workspaces[task.assignedMcpId] : undefined
  }
  const reviewTarget = session.taskGraph.tasks.find(t =>
    t.reviewRequired && t.status === 'completed' && task.dependencies.includes(t.id) && t.assignedMcpId
  )
  return reviewTarget?.assignedMcpId ? workspaces[reviewTarget.assignedMcpId] : (task.assignedMcpId ? workspaces[task.assignedMcpId] : undefined)
}
