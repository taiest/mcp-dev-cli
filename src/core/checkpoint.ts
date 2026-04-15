import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Checkpoint, TaskState, TaskStatus, CheckpointStatus } from '../types.js'
import { CHECKPOINT_FILE } from '../types.js'

export class CheckpointManager {
  private filePath: string

  constructor(projectRoot: string) {
    this.filePath = join(projectRoot, CHECKPOINT_FILE)
  }

  exists(): boolean {
    return existsSync(this.filePath)
  }

  load(): Checkpoint | null {
    if (!this.exists()) return null
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      return JSON.parse(raw) as Checkpoint
    } catch {
      return null
    }
  }

  create(requirement: string, model: string, baseBranch: string): Checkpoint {
    const cp: Checkpoint = {
      version: 1,
      session_id: randomUUID(),
      updated_at: new Date().toISOString(),
      status: 'planned',
      requirement,
      model,
      base_branch: baseBranch,
      tasks: [],
      api_contracts: [],
      merge_order: [],
    }
    this.save(cp)
    return cp
  }

  save(cp: Checkpoint): void {
    cp.updated_at = new Date().toISOString()
    writeFileSync(this.filePath, JSON.stringify(cp, null, 2), 'utf-8')
  }

  updateStatus(cp: Checkpoint, status: CheckpointStatus): void {
    cp.status = status
    this.save(cp)
  }

  updateTask(cp: Checkpoint, taskId: string, updates: Partial<TaskState>): void {
    const task = cp.tasks.find(t => t.id === taskId)
    if (task) {
      Object.assign(task, updates)
      this.save(cp)
    }
  }

  updateTaskStatus(cp: Checkpoint, taskId: string, status: TaskStatus, extra?: Partial<TaskState>): void {
    this.updateTask(cp, taskId, {
      status,
      ...(status === 'running' ? { started_at: new Date().toISOString() } : {}),
      ...(status === 'completed' || status === 'failed' ? { completed_at: new Date().toISOString() } : {}),
      ...extra,
    })
  }

  getPendingTasks(cp: Checkpoint): TaskState[] {
    return cp.tasks.filter(t => t.status === 'pending' || t.status === 'running')
  }

  getCompletedTasks(cp: Checkpoint): TaskState[] {
    return cp.tasks.filter(t => t.status === 'completed')
  }

  isAllCompleted(cp: Checkpoint): boolean {
    return cp.tasks.every(t => t.status === 'completed')
  }

  hasResumableTasks(cp: Checkpoint): boolean {
    return cp.tasks.some(t => t.status === 'pending' || t.status === 'running')
  }
}
