import type { ContractArtifact } from '../../types.js'

export function diffContracts(current: ContractArtifact, next: ContractArtifact): string {
  return current.content === next.content ? 'no-diff' : 'changed'
}
