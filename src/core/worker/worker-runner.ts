import type {
  ContractArtifact,
  ExecutionSession,
  McpNode,
  OrchestratedTask,
  ParallelProgressEvent,
  TelemetryEvent,
  WorkspaceDescriptor,
} from '../../types.js'
import { spawnClaude } from '../../utils/claude-cli.js'
import { buildWorkerPrompt } from './worker-prompt.js'
import { isReadOnlyValidationText } from './validation-task.js'

function summarizeCapturedOutput(output: string, maxLines = 24, maxChars = 4000): string {
  const snippets = output
    .split('\n')
    .map(line => parseClaudeStreamChunk(line))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, items) => items.indexOf(value) === index)

  const selected = (snippets.length > 0
    ? snippets.slice(-maxLines)
    : output
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('{') && !line.startsWith('['))
        .slice(-maxLines)
  ).join('\n')

  if (!selected) return 'no output captured'
  return selected.length > maxChars ? `${selected.slice(0, maxChars - 3)}...` : selected
}

function buildReviewContext(session: ExecutionSession): string {
  const reviewTargets = session.taskGraph.tasks
    .filter(item => item.reviewRequired)
    .map(item => {
      const output = summarizeCapturedOutput(session.artifacts[`output:${item.id}`] || '')
      return [
        `${item.id} | ${item.title}`,
        `assigned: ${item.assignedMcpId || 'none'}`,
        `status: ${item.status}`,
        `governance: ${item.governanceStatus || 'pending'}`,
        `updated: ${session.updatedAt}`,
        'latest output summary:',
        output,
      ].join('\n')
    })

  return reviewTargets.join('\n\n---\n\n')
}

function looksLikeReadOnlyValidationSummary(output: string): boolean {
  const text = output.toLowerCase()
  const hasStructuredSections = ['checks performed', 'findings', 'result'].every(section => text.includes(section))
  const hasReadOnlyStatement = /未修改仓库代码|没有修改仓库代码|did not modify (the )?repository code|no repository code was modified|read-only validation/.test(text)
  return hasStructuredSections || hasReadOnlyStatement || isReadOnlyValidationText(text)
}

function looksLikePermissionRequest(output: string): boolean {
  const text = output.toLowerCase()
  if (looksLikeReadOnlyValidationSummary(text)) return false

  return [
    /需要(你|先)?批准/,
    /请(先)?批准/,
    /请先授权/,
    /需要(你|先)?授权/,
    /等待(你|用户)?批准/,
    /等待(你|用户)?授权/,
    /未获批/,
    /未获执行授权/,
    /权限策略拦住/,
    /permission (was )?denied/,
    /permission .* blocked/,
    /need(s)? .* permission/,
    /require(s|d)? .* approval/,
    /require(s|d)? .* permission/,
    /please approve/,
    /please allow/,
    /approve .* edit/,
    /approve .* permission/,
    /allow .* edit/,
    /allow me to /,
    /before i can continue/,
    /cannot proceed without approval/,
    /can't proceed without approval/,
    /cannot continue without approval/,
    /can't continue without approval/,
  ].some(pattern => pattern.test(text))
}

function nowIso(): string {
  return new Date().toISOString()
}

function buildProgressSnippet(raw: string): string | null {
  const text = raw
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return null
  return text.length > 140 ? `${text.slice(0, 137)}...` : text
}

function extractProgressText(parsed: Record<string, unknown>): string | null {
  if (parsed.type === 'system' || parsed.subtype === 'init') return null

  const candidates = [parsed.message, parsed.content, parsed.summary, parsed.delta, parsed.result]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return buildProgressSnippet(value)
  }

  if (Array.isArray(parsed.content)) {
    for (const item of parsed.content) {
      if (!item || typeof item !== 'object') continue
      const text = 'text' in item && typeof item.text === 'string' ? item.text : null
      if (text?.trim()) return buildProgressSnippet(text)
    }
  }

  return null
}

function parseClaudeStreamChunk(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    return extractProgressText(parsed)
  } catch {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null
    return buildProgressSnippet(trimmed)
  }
}

function buildProgressSnippetFromOutput(raw: string): string | null {
  const snippets = raw
    .split('\n')
    .map(line => parseClaudeStreamChunk(line))
    .filter((value): value is string => Boolean(value))

  if (snippets.length > 0) return buildProgressSnippet(snippets[snippets.length - 1])

  const plainTextLines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('{') && !line.startsWith('['))
    .map(line => buildProgressSnippet(line))
    .filter((value): value is string => Boolean(value))

  if (plainTextLines.length === 0) return null
  return buildProgressSnippet(plainTextLines[plainTextLines.length - 1])
}

function eventBase(node: McpNode, task: OrchestratedTask, message: string): ParallelProgressEvent {
  return {
    kind: 'worker',
    message,
    timestamp: nowIso(),
    taskId: task.id,
    mcpId: node.id,
    status: task.status,
    activeModel: node.activeModel,
  }
}

function extractUsageTotals(raw: string): { totalTokens?: number; metadata?: Record<string, string> } {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type !== 'result' || typeof parsed.usage !== 'object' || !parsed.usage) continue

      const usage = parsed.usage as Record<string, unknown>
      const numberValue = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
      const inputTokens = numberValue(usage.input_tokens)
      const outputTokens = numberValue(usage.output_tokens)
      const cacheReadInputTokens = numberValue(usage.cache_read_input_tokens)
      const cacheCreationInputTokens = numberValue(usage.cache_creation_input_tokens)
      const totalTokens = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens

      return {
        totalTokens,
        metadata: {
          inputTokens: String(inputTokens),
          outputTokens: String(outputTokens),
          cacheReadInputTokens: String(cacheReadInputTokens),
          cacheCreationInputTokens: String(cacheCreationInputTokens),
        },
      }
    } catch {
      continue
    }
  }

  return {}
}

function extractFinalTextOutput(raw: string): string {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
  const textParts: string[] = []

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.type === 'result' && typeof parsed.result === 'string' && parsed.result.trim()) {
        textParts.push(parsed.result.trim())
        continue
      }

      if (parsed.type !== 'assistant' || typeof parsed.message !== 'object' || !parsed.message) continue
      const message = parsed.message as Record<string, unknown>
      const content = Array.isArray(message.content) ? message.content : []
      for (const item of content) {
        if (!item || typeof item !== 'object') continue
        const block = item as Record<string, unknown>
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          textParts.push(block.text.trim())
        }
      }
    } catch {
      if (!line.startsWith('{') && !line.startsWith('[')) textParts.push(line)
    }
  }

  const merged = textParts.join('\n').trim()
  return merged || raw.trim()
}

export class WorkerRunner {
  async run(
    session: ExecutionSession,
    node: McpNode,
    task: OrchestratedTask,
    workspace: WorkspaceDescriptor,
    contracts: ContractArtifact[],
    context: string,
    onProgress?: (event: ParallelProgressEvent) => void
  ): Promise<{ success: boolean; output: string; telemetry: TelemetryEvent }> {
    const started = Date.now()
    const prompt = buildWorkerPrompt(
      node,
      task,
      contracts,
      context,
      node.roleType === 'reviewer' ? buildReviewContext(session) : undefined,
    )

    let aggregatedStdout = ''
    let aggregatedStderr = ''
    let lastSnippet: string | null = null

    try {
      onProgress?.({
        ...eventBase(node, task, `${node.id} started ${task.id}`),
        status: 'started',
      })

      const child = spawnClaude({
        prompt,
        model: node.activeModel,
        cwd: workspace.path,
        noSessionPersistence: true,
        permissionMode: 'bypassPermissions',
        dangerouslySkipPermissions: true,
        outputFormat: 'stream-json',
      })

      child.stdout?.on('data', chunk => {
        const text = String(chunk)
        aggregatedStdout += text

        for (const line of text.split('\n')) {
          const snippet = parseClaudeStreamChunk(line)
          if (!snippet || snippet === lastSnippet) continue
          lastSnippet = snippet
          onProgress?.({
            ...eventBase(node, task, `${node.id} ${task.id}: ${snippet}`),
            status: 'running',
            snippet,
          })
        }
      })

      child.stderr?.on('data', chunk => {
        const text = String(chunk)
        aggregatedStderr += text
        const snippet = buildProgressSnippetFromOutput(text)
        if (!snippet || snippet === lastSnippet) return
        lastSnippet = snippet
        onProgress?.({
          ...eventBase(node, task, `${node.id} ${task.id} stderr: ${snippet}`),
          status: 'running',
          snippet,
        })
      })

      const result = await child
      const stdoutText = typeof result.stdout === 'string' ? result.stdout : Array.isArray(result.stdout) ? result.stdout.join('\n') : String(result.stdout || '')
      const stderrText = typeof result.stderr === 'string' ? result.stderr : Array.isArray(result.stderr) ? result.stderr.join('\n') : String(result.stderr || '')
      const usageTotals = extractUsageTotals([aggregatedStdout.trim(), stdoutText.trim()].filter(Boolean).join('\n'))
      const output = [aggregatedStdout.trim(), stdoutText.trim()].filter(Boolean).join('\n').trim() || stdoutText.trim()
      const cleanedOutput = extractFinalTextOutput(output)
      const stderr = [aggregatedStderr.trim(), stderrText.trim()].filter(Boolean).join('\n').trim() || stderrText.trim()
      const finalOutput = cleanedOutput || stderr
      const finalSnippet = buildProgressSnippetFromOutput(stderr || cleanedOutput || output || 'worker exited with non-zero status') || undefined

      if (result.exitCode !== 0) {
        onProgress?.({
          ...eventBase(node, task, `${node.id} failed ${task.id}`),
          status: 'failed',
          durationMs: Date.now() - started,
          snippet: finalSnippet,
        })
        return {
          success: false,
          output: finalOutput,
          telemetry: {
            id: `evt-${Date.now()}`,
            timestamp: nowIso(),
            sessionId: session.sessionId,
            mcpId: node.id,
            taskId: task.id,
            type: 'worker.failed',
            message: `${node.id} failed ${task.id}: ${stderr || `exit code ${result.exitCode}`}`,
            durationMs: Date.now() - started,
            totalTokens: usageTotals.totalTokens,
            activeModel: node.activeModel,
            metadata: {
              ...(finalSnippet ? { snippet: finalSnippet } : {}),
              ...(usageTotals.metadata || {}),
            },
          },
        }
      }

      if (node.roleType !== 'reviewer' && looksLikePermissionRequest(finalOutput)) {
        const approvalSnippet = buildProgressSnippetFromOutput(finalOutput) || undefined
        onProgress?.({
          ...eventBase(node, task, `${node.id} produced approval-seeking output for ${task.id}`),
          status: 'failed',
          durationMs: Date.now() - started,
          snippet: approvalSnippet,
        })
        return {
          success: false,
          output: finalOutput,
          telemetry: {
            id: `evt-${Date.now()}`,
            timestamp: nowIso(),
            sessionId: session.sessionId,
            mcpId: node.id,
            taskId: task.id,
            type: 'worker.failed',
            message: `${node.id} produced approval-seeking output for ${task.id}`,
            durationMs: Date.now() - started,
            totalTokens: usageTotals.totalTokens,
            activeModel: node.activeModel,
            metadata: {
              ...(approvalSnippet ? { snippet: approvalSnippet } : {}),
              ...(usageTotals.metadata || {}),
            },
          },
        }
      }

      const completionSnippet = buildProgressSnippetFromOutput(finalOutput) || undefined
      onProgress?.({
        ...eventBase(node, task, `${node.id} completed ${task.id}`),
        status: 'completed',
        durationMs: Date.now() - started,
        snippet: completionSnippet === lastSnippet ? undefined : completionSnippet,
      })

      return {
        success: true,
        output: finalOutput,
        telemetry: {
          id: `evt-${Date.now()}`,
          timestamp: nowIso(),
          sessionId: session.sessionId,
          mcpId: node.id,
          taskId: task.id,
          type: 'worker.completed',
          message: `${node.id} completed ${task.id}`,
          durationMs: Date.now() - started,
          totalTokens: usageTotals.totalTokens,
          activeModel: node.activeModel,
          metadata: {
            ...(completionSnippet && completionSnippet !== lastSnippet ? { snippet: completionSnippet } : {}),
            ...(usageTotals.metadata || {}),
          },
        },
      }
    } catch (error) {
      onProgress?.({
        ...eventBase(node, task, `${node.id} failed ${task.id}: ${(error as Error).message}`),
        status: 'failed',
        durationMs: Date.now() - started,
      })
      return {
        success: false,
        output: aggregatedStdout || aggregatedStderr,
        telemetry: {
          id: `evt-${Date.now()}`,
          timestamp: nowIso(),
          sessionId: session.sessionId,
          mcpId: node.id,
          taskId: task.id,
          type: 'worker.failed',
          message: `${node.id} failed ${task.id}: ${(error as Error).message}`,
          durationMs: Date.now() - started,
          totalTokens: extractUsageTotals(aggregatedStdout).totalTokens,
          activeModel: node.activeModel,
          metadata: lastSnippet ? { snippet: lastSnippet } : undefined,
        },
      }
    }
  }
}
