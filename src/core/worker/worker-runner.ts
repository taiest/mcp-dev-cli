import type { ContractArtifact, McpNode, OrchestratedTask, TelemetryEvent, WorkspaceDescriptor } from '../../types.js'
import { runClaude } from '../../utils/claude-cli.js'
import { buildWorkerPrompt } from './worker-prompt.js'

export class WorkerRunner {
  async run(
    sessionId: string,
    node: McpNode,
    task: OrchestratedTask,
    workspace: WorkspaceDescriptor,
    contracts: ContractArtifact[],
    context: string
  ): Promise<{ success: boolean; output: string; telemetry: TelemetryEvent }> {
    const started = Date.now()
    const prompt = buildWorkerPrompt(node, task, contracts, context)

    try {
      const output = await runClaude({
        prompt,
        model: node.activeModel,
        cwd: workspace.path,
        noSessionPersistence: true,
      })
      return {
        success: true,
        output,
        telemetry: {
          id: `evt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          sessionId,
          mcpId: node.id,
          taskId: task.id,
          type: 'worker.completed',
          message: `${node.id} completed ${task.id}`,
          durationMs: Date.now() - started,
          activeModel: node.activeModel,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: '',
        telemetry: {
          id: `evt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          sessionId,
          mcpId: node.id,
          taskId: task.id,
          type: 'worker.failed',
          message: `${node.id} failed ${task.id}: ${(error as Error).message}`,
          durationMs: Date.now() - started,
          activeModel: node.activeModel,
        },
      }
    }
  }
}
