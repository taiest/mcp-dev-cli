import { SessionRuntime } from '../core/runtime/session-runtime.js'
import type { ContractArtifact } from '../types.js'

function buildStructuredContractContent(producerTaskId: string, version: number, content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      ownerTaskId?: string
      version?: number
      summary?: string
      kind?: 'delivery' | 'api'
    }

    return JSON.stringify({
      ownerTaskId: parsed.ownerTaskId || producerTaskId,
      version: parsed.version || version,
      summary: parsed.summary || content || 'manual contract',
      kind: parsed.kind === 'api' ? 'api' : 'delivery',
    })
  } catch {
    return JSON.stringify({
      ownerTaskId: producerTaskId,
      version,
      summary: content || 'manual contract',
      kind: 'delivery',
    })
  }
}

export async function listContracts(projectRoot: string): Promise<string> {
  const session = new SessionRuntime(projectRoot).load()
  if (!session) return '当前没有 active parallel session。'
  return JSON.stringify(session.contracts, null, 2)
}

export async function addContract(projectRoot: string, name: string, content: string): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const session = runtime.load()
  if (!session) return '当前没有 active parallel session。'

  const producerTaskId = session.taskGraph.tasks.find(task => task.roleType === 'architect' || task.roleType === 'developer')?.id
    || session.taskGraph.tasks[0]?.id
    || 'manual'
  const consumerTaskIds = session.taskGraph.tasks
    .map(task => task.id)
    .filter(taskId => taskId !== producerTaskId)
  const contract: ContractArtifact = {
    id: `contract-${Date.now()}`,
    name,
    producerTaskId,
    consumerTaskIds,
    version: 1,
    content: buildStructuredContractContent(producerTaskId, 1, content),
    validationStatus: 'valid',
  }

  runtime.save({ ...session, contracts: [...session.contracts, contract] })
  return `✅ contract added: ${name}`
}
