import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { SessionStore } from '../core/runtime/session-store.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { parseWorkspaceMap } from './foreground-execution.js'
import { renderPatchHeader, renderContextList } from '../core/terminal/ui.js'
import type { OrchestratedTask } from '../types.js'

export async function patchSession(projectRoot: string, requirement: string, targetMcpId?: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) {
    return '当前没有可追加的 parallel session。请先运行 parallel_start 创建一个。'
  }

  if (session.phase !== 'completed' && session.phase !== 'failed') {
    return `当前 session 处于 ${session.phase} 阶段，只有 completed 或 failed 的 session 才能追加 patch。`
  }

  const resolvedMcpId = targetMcpId || findBestMcp(session, requirement)
  const targetMcp = session.mcps.find(m => m.id === resolvedMcpId)
  if (!targetMcp) {
    return `找不到 MCP ${resolvedMcpId}。可用: ${session.mcps.map(m => m.id).join(', ')}`
  }

  const store = new SessionStore(projectRoot)
  const contexts = store.listMcpContexts(resolvedMcpId)

  const maxId = Math.max(...session.taskGraph.tasks.map(t => parseInt(t.id.replace('task-', ''), 10) || 0))
  const newTaskId = `task-${maxId + 1}`
  const originalTask = session.taskGraph.tasks.find(t => t.assignedMcpId === resolvedMcpId && t.status === 'completed')

  const patchTask: OrchestratedTask = {
    id: newTaskId,
    title: `[patch] ${requirement.slice(0, 60)}`,
    description: requirement,
    roleType: targetMcp.roleType,
    assignedMcpId: resolvedMcpId,
    status: 'ready',
    dependencies: [],
    files: originalTask?.files || [],
    priority: originalTask?.priority || 1,
    reviewRequired: false,
    reviewAssignedTo: [],
    governanceStatus: 'pending',
    approvedBy: [],
    rejectedBy: [],
    artifacts: [],
    fallbackPlan: [],
    contracts: [],
    prompt: requirement,
  }

  const patched = runtime.appendAudit({
    ...session,
    phase: 'running',
    taskGraph: {
      ...session.taskGraph,
      tasks: [...session.taskGraph.tasks, patchTask],
    },
    updatedAt: new Date().toISOString(),
  }, [
    createAuditRecord({
      sessionId: session.sessionId,
      scope: 'session',
      action: 'patch-session',
      status: 'passed',
      actor: session.controllerMcpId,
      message: `patch task ${newTaskId} added for ${resolvedMcpId}: ${requirement}`,
    }),
  ])
  runtime.save(patched)

  const headerOutput = renderPatchHeader({
    sessionId: session.sessionId,
    requirement,
    targetMcpId: resolvedMcpId,
    targetRole: targetMcp.roleType,
    originalTaskId: originalTask?.id || 'none',
    newTaskId,
    contexts,
  })

  const contextOutput = contexts.length > 0 ? renderContextList(contexts.map(c => ({
    mcpId: c.mcpId, taskId: c.taskId, file: '', title: c.title, status: c.status, createdAt: c.createdAt, tokens: c.tokens,
  }))) : ''

  return [
    headerOutput,
    contextOutput,
    '',
    `Patch 任务 ${newTaskId} 已创建并分配给 ${resolvedMcpId}。`,
    '请调用 parallel_next_batch 获取可执行任务，然后用 Agent() 执行。',
  ].filter(Boolean).join('\n')
}

function findBestMcp(session: import('../types.js').ExecutionSession, requirement: string): string {
  const words = requirement.toLowerCase().split(/\s+/)
  let bestId = session.mcps[0]?.id || 'MCP-01'
  let bestScore = -1

  for (const mcp of session.mcps) {
    const tasks = session.taskGraph.tasks.filter(t => t.assignedMcpId === mcp.id)
    const taskText = tasks.map(t => `${t.title} ${t.description}`).join(' ').toLowerCase()
    const score = words.filter(w => taskText.includes(w)).length
    if (score > bestScore) {
      bestScore = score
      bestId = mcp.id
    }
  }
  return bestId
}
