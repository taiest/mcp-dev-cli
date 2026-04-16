import type { ApiContract } from '../types.js'

export class ContractManager {
  constructor(private projectRoot: string) {}

  ensureDir(): void {
    return
  }

  save(_contracts: ApiContract[]): void {
    throw new Error(`legacy ContractManager retired; use parallel contract store in ${this.projectRoot}`)
  }

  loadAll(): string {
    return ''
  }

  list(): string[] {
    return []
  }
}
