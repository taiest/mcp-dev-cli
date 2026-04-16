import { existsSync } from 'node:fs'
import type { ExecutionSession, WorkspaceDescriptor } from '../../types.js'

export class ResumeRebuilder {
  rebuild(session: ExecutionSession): ExecutionSession {
    const workspaceMap = this.restoreWorkspaceMap(session.artifacts.workspaceMap)
    const taskIds = session.taskGraph.tasks
      .filter(task => task.status !== 'completed')
      .map(task => task.id)

    return {
      ...session,
      updatedAt: new Date().toISOString(),
      phase: session.phase === 'completed' ? 'completed' : 'running',
      telemetry: [...session.telemetry],
      contracts: [...session.contracts],
      artifacts: {
        ...session.artifacts,
        workspaceMap: JSON.stringify(Object.fromEntries(workspaceMap.entries()), null, 2),
        resumeRebuiltAt: new Date().toISOString(),
      },
      mcps: session.mcps.map(mcp => ({
        ...mcp,
        status: taskIds.some(taskId => session.taskGraph.tasks.some(task => task.id === taskId && task.assignedMcpId === mcp.id))
          ? (workspaceMap.has(mcp.id) ? 'idle' : 'blocked')
          : 'idle',
      })),
      taskGraph: {
        tasks: session.taskGraph.tasks.map(task => ({ ...task })),
      },
      resumeCursor: {
        phase: session.phase === 'completed' ? 'completed' : 'running',
        taskIds,
      },
    }
  }

  private restoreWorkspaceMap(raw: string | undefined): Map<string, WorkspaceDescriptor> {
    if (!raw) return new Map()
    try {
      const parsed = JSON.parse(raw) as Record<string, WorkspaceDescriptor>
      const restored = new Map<string, WorkspaceDescriptor>()
      for (const [mcpId, descriptor] of Object.entries(parsed)) {
        if (descriptor?.path && existsSync(descriptor.path)) {
          restored.set(mcpId, descriptor)
        }
      }
      return restored
    } catch {
      return new Map()
    }
  }
}
