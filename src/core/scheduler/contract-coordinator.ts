import type { ContractArtifact, ExecutionSession, OrchestratedTask } from '../../types.js'
import { ContractValidator } from '../contracts/contract-validator.js'

export class ContractCoordinator {
  private validator = new ContractValidator()

  attach(session: ExecutionSession, contracts: ContractArtifact[]): ExecutionSession {
    const validContracts = new Set(contracts.filter(contract => this.validator.validate(contract)).map(contract => contract.id))

    return {
      ...session,
      contracts,
      taskGraph: {
        tasks: session.taskGraph.tasks.map(task => this.applyContractGate(task, validContracts)),
      },
    }
  }

  private applyContractGate(task: OrchestratedTask, validContracts: Set<string>): OrchestratedTask {
    const requiredContracts = Array.from(new Set([
      ...task.contracts,
      ...this.contractsRequiredByRole(task),
    ]))
    if (requiredContracts.length === 0) return task

    const missing = requiredContracts.filter(contractId => !validContracts.has(contractId))
    if (missing.length === 0) {
      return {
        ...task,
        contracts: requiredContracts,
      }
    }

    return {
      ...task,
      status: 'blocked',
      contracts: requiredContracts,
      fallbackPlan: [...task.fallbackPlan, `repair-contracts:${missing.join(',')}`],
      artifacts: [...task.artifacts, `blocked-by-contract:${missing.join(',')}`],
    }
  }

  private contractsRequiredByRole(task: OrchestratedTask): string[] {
    if (task.roleType !== 'developer' && task.roleType !== 'architect') return []
    if (!task.reviewRequired && task.contracts.length === 0) return []
    return [`contract:${task.id}`]
  }
}
