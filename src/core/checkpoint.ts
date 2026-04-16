import type { Checkpoint, CheckpointStatus, TaskState, TaskStatus } from '../types.js'

export class CheckpointManager {
  constructor(private projectRoot: string) {}

  private retired(method: string): never {
    throw new Error(`legacy CheckpointManager.${method} retired; use parallel session runtime in ${this.projectRoot}`)
  }

  exists(): boolean {
    return false
  }

  load(): Checkpoint | null {
    return null
  }

  create(_requirement: string, _model: string, _baseBranch: string): Checkpoint {
    this.retired('create')
  }

  save(_cp: Checkpoint): void {
    this.retired('save')
  }

  updateStatus(_cp: Checkpoint, _status: CheckpointStatus): void {
    this.retired('updateStatus')
  }

  updateTask(_cp: Checkpoint, _taskId: string, _updates: Partial<TaskState>): void {
    this.retired('updateTask')
  }

  updateTaskStatus(_cp: Checkpoint, _taskId: string, _status: TaskStatus, _extra?: Partial<TaskState>): void {
    this.retired('updateTaskStatus')
  }

  getPendingTasks(_cp: Checkpoint): TaskState[] {
    return []
  }

  getCompletedTasks(_cp: Checkpoint): TaskState[] {
    return []
  }

  isAllCompleted(_cp: Checkpoint): boolean {
    return false
  }

  hasResumableTasks(_cp: Checkpoint): boolean {
    return false
  }
}
