import type { Config, TaskState, WorkerResult } from '../types.js'

export class WorkerManager {
  constructor(private config: Config) {}

  async runWorker(task: TaskState): Promise<WorkerResult> {
    return {
      taskId: task.id,
      branch: task.branch,
      success: false,
      error: `legacy WorkerManager retired; use parallel_start or parallel_resume in ${this.config.projectRoot}`,
      duration: 0,
    }
  }

  async runParallel(tasks: TaskState[]): Promise<WorkerResult[]> {
    return Promise.all(tasks.map(task => this.runWorker(task)))
  }
}
