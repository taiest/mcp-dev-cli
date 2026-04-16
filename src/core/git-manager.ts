import type { MergeResult } from '../types.js'

export class GitManager {
  constructor(private cwd: string) {}

  private retired(method: string): never {
    throw new Error(`legacy GitManager.${method} retired; use workspace/git services in ${this.cwd}`)
  }

  async currentBranch(): Promise<string> {
    this.retired('currentBranch')
  }

  async createBranch(_name: string, _base?: string): Promise<void> {
    this.retired('createBranch')
  }

  async checkout(_branch: string): Promise<void> {
    this.retired('checkout')
  }

  async branchExists(_name: string): Promise<boolean> {
    this.retired('branchExists')
  }

  async merge(_source: string, _target: string): Promise<MergeResult> {
    this.retired('merge')
  }

  async abortMerge(): Promise<void> {
    this.retired('abortMerge')
  }

  async hasConflicts(_source: string, _target: string): Promise<boolean> {
    this.retired('hasConflicts')
  }

  async deleteBranch(_name: string): Promise<void> {
    this.retired('deleteBranch')
  }

  async cleanupBranches(_pattern?: string): Promise<void> {
    this.retired('cleanupBranches')
  }

  async stashIfDirty(): Promise<boolean> {
    this.retired('stashIfDirty')
  }

  async stashPop(): Promise<void> {
    this.retired('stashPop')
  }

  async getChangedFiles(_branch: string, _base: string): Promise<string[]> {
    this.retired('getChangedFiles')
  }
}
