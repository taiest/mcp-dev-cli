import { SessionStore } from '../core/runtime/session-store.js'
import { renderContextList, renderContextDetail } from '../core/terminal/ui.js'

export function manageContext(
  projectRoot: string,
  action: string,
  mcpId?: string,
  taskId?: string,
  timestamp?: string,
): string {
  const store = new SessionStore(projectRoot)

  if (action === 'list') {
    const index = store.loadContextIndex()
    if (index.length === 0) {
      return '📦 Context Cache\n\n  暂无上下文缓存。执行 parallel_approve 后会自动生成。'
    }
    return renderContextList(index)
  }

  if (action === 'show') {
    if (!mcpId || !taskId) {
      return '请指定 mcpId 和 taskId。例如: parallel_context show mcp-02 task-1'
    }
    const snapshot = store.loadTaskContext(mcpId, taskId)
    if (!snapshot) {
      return `找不到 ${mcpId}/${taskId} 的上下文缓存。`
    }
    return renderContextDetail(snapshot)
  }

  if (action === 'restore') {
    if (!timestamp) {
      return '请指定时间点。例如: parallel_context restore "2025-01-15 14:32"'
    }
    const snapshots = store.loadContextByTimestamp(timestamp)
    if (snapshots.length === 0) {
      return `在 ${timestamp} 之前没有找到上下文缓存。`
    }
    return renderContextList(
      snapshots.map(s => ({
        mcpId: s.mcpId,
        taskId: s.taskId,
        file: '',
        title: s.title,
        status: s.status,
        createdAt: s.createdAt,
        tokens: s.tokens,
      })),
    )
  }

  return `未知操作: ${action}。支持: list / show / restore`
}
