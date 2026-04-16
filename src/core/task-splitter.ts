import type { Config, TaskPlan } from '../types.js'

export class TaskSplitter {
  constructor(private config: Config) {}

  async split(_requirement: string): Promise<TaskPlan> {
    throw new Error(`legacy TaskSplitter retired; use parallel task graph flow in ${this.config.projectRoot}`)
  }
}
