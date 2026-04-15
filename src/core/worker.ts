import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import type { TaskState, WorkerResult, Config, AgentConfig } from '../types.js'
import { AGENTS_DIR, BRANCH_PREFIX } from '../types.js'
import { log } from '../utils/logger.js'
import { ContractManager } from './contract.js'

export class WorkerManager {
  private config: Config
  private contractManager: ContractManager

  constructor(config: Config) {
    this.config = config
    this.contractManager = new ContractManager(config.projectRoot)
  }

  loadAgent(role: string): AgentConfig | null {
    const filePath = join(this.config.projectRoot, AGENTS_DIR, `${role}.md`)
    if (!existsSync(filePath)) return null

    const raw = readFileSync(filePath, 'utf-8')
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!frontmatterMatch) return null

    const meta: Record<string, string> = {}
    for (const line of frontmatterMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        if (key && value) meta[key] = value
      }
    }

    return {
      name: meta['name'] || role,
      description: meta['description'] || '',
      tools: meta['tools'] || '',
      model: meta['model'] || 'sonnet',
      color: meta['color'] || 'white',
      content: frontmatterMatch[2].trim(),
    }
  }

  async runWorker(task: TaskState): Promise<WorkerResult> {
    const startTime = Date.now()
    const agent = this.loadAgent(task.role)
    const contracts = this.contractManager.loadAll()

    const systemPromptParts = [
      agent?.content || `你是 ${task.role} 角色，请完成分配的开发任务。`,
      `\n## 当前任务\n\n${task.description}`,
      task.files.length > 0 ? `\n## 需要关注的文件\n\n${task.files.join('\n')}` : '',
      contracts ? `\n## 接口契约\n\n${contracts}` : '',
      this.config.contextSummaryText ? `\n${this.config.contextSummaryText}` : '',
      '\n## 重要提示\n\n- 完成后确保代码可编译\n- 不要修改不相关的文件\n- 遵循项目现有代码风格',
    ]

    const branch = task.branch.startsWith(BRANCH_PREFIX) ? task.branch : `${BRANCH_PREFIX}${task.branch}`

    try {
      await execa('git', ['checkout', branch], { cwd: this.config.projectRoot })
    } catch {
      log.warn(`分支 ${branch} 不存在，在当前分支上工作`)
    }

    log.run(`[${task.role}] 开始执行: ${task.title}`)

    try {
      const result = await execa('claude', [
        '-p', task.prompt,
        '--append-system-prompt', systemPromptParts.join('\n'),
        '--output-format', 'json',
        '--model', agent?.model || this.config.model,
        ...(agent?.tools ? ['--allowed-tools', agent.tools] : []),
        '--no-session-persistence',
      ], {
        cwd: this.config.projectRoot,
        reject: false,
        timeout: 1_800_000,
      })

      const success = result.exitCode === 0
      const duration = Date.now() - startTime

      if (success) {
        log.success(`[${task.role}] 完成: ${task.title} (${Math.round(duration / 1000)}s)`)
      } else {
        log.error(`[${task.role}] 失败: ${task.title} - ${result.stderr?.slice(0, 200)}`)
      }

      return {
        taskId: task.id,
        branch,
        success,
        error: success ? undefined : result.stderr?.slice(0, 500),
        duration,
      }
    } catch (e) {
      const duration = Date.now() - startTime
      const error = (e as Error).message
      log.error(`[${task.role}] 异常: ${task.title} - ${error}`)
      return { taskId: task.id, branch, success: false, error, duration }
    }
  }

  async runParallel(tasks: TaskState[]): Promise<WorkerResult[]> {
    const completed = new Set<string>()
    const results: WorkerResult[] = []

    while (completed.size < tasks.length) {
      const ready = tasks.filter(t =>
        !completed.has(t.id) &&
        t.dependencies.every(dep => completed.has(dep))
      )

      if (ready.length === 0) {
        log.error('检测到循环依赖或所有剩余任务都被阻塞')
        break
      }

      const batch = ready.slice(0, this.config.maxConcurrency)
      log.info(`并行启动 ${batch.length} 个 worker: ${batch.map(t => t.role).join(', ')}`)

      const batchResults = await Promise.allSettled(
        batch.map(task => this.runWorker(task))
      )

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value)
          completed.add(result.value.taskId)
        } else {
          log.error(`Worker 异常: ${result.reason}`)
        }
      }
    }

    return results
  }
}
