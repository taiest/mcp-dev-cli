import type { ExecutionSession, McpNodeStatus, OrchestratedTaskStatus } from '../types.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { SessionStore } from '../core/runtime/session-store.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { AssignmentEngine } from '../core/scheduler/assignment-engine.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'

export interface TaskDoneInput {
  taskId: string
  mcpId: string
  success: boolean
  output: string
  durationMs?: number
  totalTokens?: number
}

export interface TaskDoneResult {
  taskId: string
  status: string
  newlyUnlocked: string[]
  completed: number
  total: number
  progress: string
  hasMore: boolean
  instruction: string
}

export async function reportTaskDone(projectRoot: string, input: TaskDoneInput): Promise<TaskDoneResult> {
  const runtime = new SessionRuntime(projectRoot)
  let session = runtime.load()
  if (!session) throw new Error('No active session')

  const task = session.taskGraph.tasks.find(t => t.id === input.taskId)
  if (!task) throw new Error(`Task ${input.taskId} not found`)

  const status: OrchestratedTaskStatus = input.success ? 'completed' : 'failed'

  // Update task status
  session = {
    ...session,
    phase: status === 'failed' ? 'failed' : session.phase,
    taskGraph: {
      ...session.taskGraph,
      tasks: session.taskGraph.tasks.map(t => t.id === input.taskId ? {
        ...t,
        status,
        governanceStatus: t.reviewRequired && status === 'completed' ? 'waiting_approval' : t.governanceStatus,
        artifacts: input.output ? [...t.artifacts, `output:${input.taskId}`] : t.artifacts,
        lastFailureReason: status === 'failed' ? 'task execution failed' : t.lastFailureReason,
      } : t),
    },
    mcps: session.mcps.map(m => m.id === input.mcpId ? { ...m, status: (status === 'failed' ? 'failed' : 'idle') as McpNodeStatus } : m),
    artifacts: {
      ...session.artifacts,
      ...(input.output ? { [`output:${input.taskId}`]: input.output } : {}),
    },
    laneStates: session.laneStates?.map(lane => lane.mcpId === input.mcpId ? {
      ...lane,
      latestReply: `${input.taskId} ${status}`,
      currentElapsedMs: 0,
      currentTokens: 0,
      cumulativeElapsedMs: lane.cumulativeElapsedMs + (input.durationMs || 0),
      cumulativeTokens: lane.cumulativeTokens + (input.totalTokens || 0),
    } : lane),
    telemetry: [...session.telemetry, {
      id: `evt-${Date.now()}`,
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      mcpId: input.mcpId,
      taskId: input.taskId,
      type: status === 'completed' ? 'task.completed' : 'task.failed',
      message: `${input.mcpId} ${status} ${input.taskId}`,
      durationMs: input.durationMs,
      totalTokens: input.totalTokens,
      activeModel: session.mcps.find(m => m.id === input.mcpId)?.activeModel || 'unknown',
    }],
  }

  // Handle reassignment on failure
  if (!input.success && (task.reassignmentCount || 0) < 2) {
    const engine = new AssignmentEngine()
    const replacement = engine.pickReplacement(task, session.mcps, task.assignedMcpId)
    if (replacement) {
      session = {
        ...session,
        phase: session.phase === 'failed' ? 'running' : session.phase, // revert failed phase
        reassignmentHistory: [...(session.reassignmentHistory || []), {
          taskId: input.taskId,
          fromMcpId: input.mcpId,
          toMcpId: replacement.id,
          reason: 'task failed, auto-reassigned',
          timestamp: new Date().toISOString(),
        }],
        taskGraph: {
          ...session.taskGraph,
          tasks: session.taskGraph.tasks.map(t => t.id === input.taskId ? {
            ...t,
            status: 'pending' as OrchestratedTaskStatus,
            assignedMcpId: replacement.id,
            reassignmentCount: (t.reassignmentCount || 0) + 1,
            lastFailureReason: 'task failed, auto-reassigned',
            previousAssignments: [...(t.previousAssignments || []), input.mcpId],
          } : t),
        },
        mcps: session.mcps.map(m => m.id === input.mcpId ? { ...m, status: 'idle' as McpNodeStatus } : m),
      }
    }
  }

  // Save task context
  const store = new SessionStore(projectRoot)
  store.saveTaskContext({
    mcpId: input.mcpId,
    taskId: input.taskId,
    sessionId: session.sessionId,
    roleType: task.roleType,
    title: task.title,
    requirement: session.requirement,
    status,
    output: (input.output || '').slice(0, 4000),
    files: task.files || [],
    durationMs: input.durationMs || 0,
    tokens: input.totalTokens || 0,
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  })

  // Reconcile to unlock dependents
  const scheduler = new Scheduler()
  session = scheduler.reconcile(session)
  session = runtime.appendAudit(session, [createAuditRecord({
    sessionId: session.sessionId,
    scope: 'session',
    action: 'task-done-reported',
    status: input.success ? 'passed' : 'failed',
    actor: input.mcpId,
    taskId: input.taskId,
    message: `${input.taskId} ${status} via parallel_task_done`,
  })])

  session = {
    ...session,
    resumeCursor: {
      phase: session.phase,
      taskIds: session.taskGraph.tasks.filter(t => t.status !== 'completed').map(t => t.id),
    },
  }
  runtime.save(session)

  const allTasks = session.taskGraph.tasks
  const completed = allTasks.filter(t => t.status === 'completed').length
  const total = allTasks.length
  const newlyUnlocked = allTasks.filter(t => t.status === 'ready').map(t => t.id)
  const running = allTasks.filter(t => t.status === 'running').length
  const hasMore = newlyUnlocked.length > 0 || running > 0 || allTasks.some(t => t.status === 'pending' || t.status === 'blocked')

  let instruction: string
  if (newlyUnlocked.length > 0) {
    instruction = `新解锁 ${newlyUnlocked.length} 个任务: ${newlyUnlocked.join(', ')}。请调用 parallel_next_batch 获取下一批。`
  } else if (running > 0) {
    instruction = `还有 ${running} 个任务在执行中，等待完成后回报。`
  } else if (!hasMore) {
    instruction = '所有任务已完成。请调用 parallel_finalize 进行合并和报告。'
  } else {
    instruction = '请调用 parallel_next_batch 检查是否有新的可执行任务。'
  }

  return {
    taskId: input.taskId,
    status,
    newlyUnlocked,
    completed,
    total,
    progress: `${completed}/${total} completed`,
    hasMore,
    instruction,
  }
}
