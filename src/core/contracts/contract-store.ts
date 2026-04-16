import type { ContractArtifact } from '../../types.js'

export class ContractStore {
  private contracts = new Map<string, ContractArtifact>()

  save(contract: ContractArtifact): void {
    this.contracts.set(contract.id, contract)
  }

  list(): ContractArtifact[] {
    return Array.from(this.contracts.values())
  }
}
