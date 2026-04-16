import type { OrchestratedTask } from '../../types.js'

export function getReadyTasks(tasks: OrchestratedTask[]): OrchestratedTask[] {
  const completed = new Set(tasks.filter(task => task.status === 'completed').map(task => task.id))
  return tasks.filter(task => task.status === 'ready' || (task.status === 'pending' && task.dependencies.every(dep => completed.has(dep))))
}
