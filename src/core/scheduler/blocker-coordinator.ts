import type { ExecutionSession } from '../../types.js'

export class BlockerCoordinator {
  findBlockedTasks(session: ExecutionSession): string[] {
    const completed = new Set(session.taskGraph.tasks.filter(task => task.status === 'completed').map(task => task.id))
    return session.taskGraph.tasks
      .filter(task => task.dependencies.some(dep => !completed.has(dep)) && task.status !== 'completed')
      .map(task => task.id)
  }
}
