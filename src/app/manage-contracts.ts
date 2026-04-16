import { SessionRuntime } from '../core/runtime/session-runtime.js'
import type { ContractArtifact } from '../types.js'

export async function listContracts(projectRoot: string): Promise<string> {
  const session = new SessionRuntime(projectRoot).load()
  if (!session) return '当前没有 active parallel session。'
  return JSON.stringify(session.contracts, null, 2)
}

export async function addContract(projectRoot: string, name: string, content: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) return '当前没有 active parallel session。'
  const contract: ContractArtifact = {
    id: `contract-${Date.now()}`,
    name,
    producerTaskId: 'manual',
    consumerTaskIds: [],
    version: 1,
    content,
    validationStatus: 'valid',
  }
  runtime.save({ ...session, contracts: [...session.contracts, contract] })
  return `✅ contract added: ${name}`
}
