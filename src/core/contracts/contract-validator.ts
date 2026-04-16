import type { ContractArtifact, PreflightReport } from '../../types.js'

interface StructuredContract {
  ownerTaskId: string
  version: number
  summary: string
  kind: 'delivery' | 'api'
}

export class ContractValidator {
  validate(contract: ContractArtifact): boolean {
    const structured = this.parse(contract)
    return Boolean(structured)
      && contract.consumerTaskIds.length > 0
      && contract.validationStatus !== 'invalid'
  }

  validateAll(contracts: ContractArtifact[]): PreflightReport {
    const checks = contracts.map(contract => {
      const structured = this.parse(contract)
      const valid = Boolean(structured)
        && contract.consumerTaskIds.length > 0
        && contract.validationStatus !== 'invalid'
      return {
        name: `contract:${contract.name}`,
        status: valid ? 'passed' : 'failed',
        message: valid ? '契约校验通过' : `契约无效: ${contract.id}`,
        autoFixable: false,
      } as const
    })

    return {
      passed: checks.every(check => check.status !== 'failed'),
      checks,
    }
  }

  private parse(contract: ContractArtifact): StructuredContract | null {
    try {
      const parsed = JSON.parse(contract.content) as Partial<StructuredContract>
      if (!parsed.ownerTaskId || parsed.ownerTaskId !== contract.producerTaskId) return null
      if (!parsed.summary || typeof parsed.summary !== 'string') return null
      if (!parsed.version || parsed.version !== contract.version) return null
      if (parsed.kind !== 'delivery' && parsed.kind !== 'api') return null
      return parsed as StructuredContract
    } catch {
      return null
    }
  }
}
