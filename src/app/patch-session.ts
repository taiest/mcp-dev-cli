import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { SessionStore } from '../core/runtime/session-store.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { parseWorkspaceMap, runForegroundExecution } from './foreground-execution.js'
import { renderPatchHeader, renderContextList } from '../core/terminal/ui.js'
import type { OrchestratedTask } from '../types.js'

export async function patchSession(projectRoot: string, requirement: string, targetMcpId?: string, server?: Server): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) {
    return '当前没有可追加的 parallel session。请先运行 parallel_start 创建一个。'
  }

  if (session.phase !== 'completed' && session.phase !== 'failed') {
    return `当前 session 处于 ${session.phase} 阶段，只有 completed 或 failed 的 session 才能追加 patch。`
  }

  // Find target MCP — prefer explicit, fallback to matching by requirement keywords
  const resolvedMcpId = targetMcpId || findBestMcp(session, requirement)
  const targetMcp = session.mcps.find(m => m.id === resolvedMcpId)
  if (!targetMcp) {
    return `找不到 MCP ${resolvedMcpId}。可用: ${session.mcps.map(m => m.id).join(', ')}`
  }

  // Load context for the target MCP
  const store = new SessionStore(projectRoot)
  const contexts = store.listMcpContexts(resolvedMcpId)

  // Generate new task ID
  const maxId = Math.max(...session.taskGraph.tasks.map(t => parseInt(t.id.replace('task-', ''), 10) || 0))
  const newTaskId = `task-${maxId + 1}`

  // Find original task for this MCP
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

  // Reopen session with patch task
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

  const workspaces = parseWorkspaceMap(session.artifacts.workspaceMap)

  // Build header output
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

  const execution = await runForegroundExecution({
    projectRoot,
    session: patched,
    workspaces,
    title: '🔧 Parallel Patch',
    nextStep: finalSession => finalSession.phase === 'completed'
      ? 'parallel_report 查看完整报告 | parallel_context 查看上下文缓存'
      : 'parallel_dashboard 查看当前状态',
    contextAnalysis: `patch execution: ${requirement}`,
    taskAction: 'patch-task-execution',
    mergeAction: 'patch-merge-session',
    mergeSuccessMessage: 'patch merge completed',
    mergeFailureFallback: 'patch merge failed',
    server,
  })

  return [headerOutput, contextOutput, '', execution.output].filter(Boolean).join('\n')
}

function findBestMcp(session: import('../types.js').ExecutionSession, requirement: string): string {
  // Simple heuristic: find MCP whose completed tasks have the most keyword overlap
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
