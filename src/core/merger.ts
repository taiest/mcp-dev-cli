import type { Config, WorkerResult } from '../types.js'

export class Merger {
  constructor(private config: Config) {}

  async mergeAll(_results: WorkerResult[], _mergeOrder: string[], _baseBranch: string): Promise<{ success: boolean; errors: string[] }> {
    return {
      success: false,
      errors: [`legacy Merger retired; use parallel session merge flow in ${this.config.projectRoot}`],
    }
  }

  async verify(): Promise<{ success: boolean; errors: string[] }> {
    return {
      success: false,
      errors: [`legacy Merger verify retired; use quality gate in ${this.config.projectRoot}`],
    }
  }

  async fixBuildErrors(_errors: string[]): Promise<boolean> {
    return false
  }

  async cleanupBranches(): Promise<void> {
    return
  }
}
