import type { Config, TaskPlan, TaskState } from '../types.js'
import { BRANCH_PREFIX } from '../types.js'
import { log } from '../utils/logger.js'
import { CheckpointManager } from './checkpoint.js'
import { GitManager } from './git-manager.js'
import { TaskSplitter } from './task-splitter.js'
import { WorkerManager } from './worker.js'
import { Merger } from './merger.js'
import { ContractManager } from './contract.js'

export class Orchestrator {
  private config: Config
  private checkpoint: CheckpointManager
  private git: GitManager
  private splitter: TaskSplitter
  private workers: WorkerManager
  private merger: Merger
  private contracts: ContractManager

  constructor(config: Config) {
    this.config = config
    this.checkpoint = new CheckpointManager(config.projectRoot)
    this.git = new GitManager(config.projectRoot)
    this.splitter = new TaskSplitter(config)
    this.workers = new WorkerManager(config)
    this.merger = new Merger(config)
    this.contracts = new ContractManager(config.projectRoot)
  }

  async start(requirement: string): Promise<string> {
    log.header('🚀 MCP 协同开发')
    log.info(`需求: ${requirement}`)
    log.blank()

    // Phase 1: 拆分任务
    const plan = await this.splitter.split(requirement)
    this.displayPlan(plan)

    // 保存接口契约
    if (plan.api_contracts && plan.api_contracts.length > 0) {
      this.contracts.save(plan.api_contracts)
      log.info(`保存了 ${plan.api_contracts.length} 个接口契约`)
    }

    // Phase 2: 创建分支
    const baseBranch = await this.git.currentBranch()
    const stashed = await this.git.stashIfDirty()
    if (stashed) log.git('已暂存未提交的修改')

    const cp = this.checkpoint.create(requirement, this.config.model, baseBranch)
    cp.merge_order = plan.merge_order
    cp.api_contracts = plan.api_contracts?.map(c => c.name) || []

    const tasks: TaskState[] = plan.tasks.map(t => ({
      ...t,
      branch: `${BRANCH_PREFIX}${t.role}-${t.id}`,
      status: 'pending' as const,
      progress: '',
    }))
    cp.tasks = tasks

    // 创建 git 分支
    for (const task of tasks) {
      await this.git.checkout(baseBranch)
      await this.git.createBranch(task.branch)
    }
    this.checkpoint.updateStatus(cp, 'branched')

    // Phase 3: 并行执行
    await this.git.checkout(baseBranch)
    this.checkpoint.updateStatus(cp, 'executing')

    for (const task of tasks) {
      this.checkpoint.updateTaskStatus(cp, task.id, 'running')
    }

    const results = await this.workers.runParallel(tasks)

    // 更新 checkpoint
    for (const result of results) {
      this.checkpoint.updateTaskStatus(cp, result.taskId,
        result.success ? 'completed' : 'failed',
        result.success ? undefined : { error: result.error }
      )
    }

    // Phase 4: 合并
    this.checkpoint.updateStatus(cp, 'merging')
    await this.git.checkout(baseBranch)
    const mergeResult = await this.merger.mergeAll(results, plan.merge_order, baseBranch)

    if (!mergeResult.success) {
      log.error(`合并阶段有错误: ${mergeResult.errors.join('; ')}`)
    }

    // Phase 5: 编译验证
    const verifyResult = await this.merger.verify()
    if (!verifyResult.success) {
      log.warn('编译验证失败，尝试自动修复...')
      const fixed = await this.merger.fixBuildErrors(verifyResult.errors)
      if (!fixed) {
        log.error('自动修复失败，请手动检查')
      }
    }

    // Phase 6: 清理
    this.checkpoint.updateStatus(cp, 'completed')
    this.printReport(cp, results)

    // 恢复 stash
    if (stashed) {
      try { await this.git.stashPop() } catch { /* ignore */ }
    }

    return log.flush()
  }

  async resume(): Promise<string> {
    const cp = this.checkpoint.load()
    if (!cp || !this.checkpoint.hasResumableTasks(cp)) {
      log.info('没有可恢复的任务')
      return log.flush()
    }

    log.header('🔄 断点续跑')
    log.info(`恢复会话: ${cp.session_id.slice(0, 8)}`)
    log.info(`需求: ${cp.requirement}`)

    const pendingTasks = this.checkpoint.getPendingTasks(cp)
    log.info(`待执行任务: ${pendingTasks.length} 个`)

    // 重新执行
    this.checkpoint.updateStatus(cp, 'executing')
    const results = await this.workers.runParallel(pendingTasks)

    for (const result of results) {
      this.checkpoint.updateTaskStatus(cp, result.taskId,
        result.success ? 'completed' : 'failed',
        result.success ? undefined : { error: result.error }
      )
    }

    // 如果全部完成，进入合并
    if (this.checkpoint.isAllCompleted(cp)) {
      this.checkpoint.updateStatus(cp, 'merging')
      await this.git.checkout(cp.base_branch)

      const allResults = cp.tasks.map(t => ({
        taskId: t.id,
        branch: t.branch,
        success: t.status === 'completed',
      }))
      await this.merger.mergeAll(allResults, cp.merge_order, cp.base_branch)

      const verifyResult = await this.merger.verify()
      if (!verifyResult.success) {
        await this.merger.fixBuildErrors(verifyResult.errors)
      }

      this.checkpoint.updateStatus(cp, 'completed')
    }

    this.printReport(cp, results)
    return log.flush()
  }

  private displayPlan(plan: TaskPlan): void {
    log.header('📋 任务拆分方案')
    for (const task of plan.tasks) {
      const deps = task.dependencies.length > 0 ? ` (依赖: ${task.dependencies.join(', ')})` : ''
      log.info(`#${task.id} [${task.role}] ${task.title}${deps}`)
      if (task.files.length > 0) {
        log.info(`     文件: ${task.files.join(', ')}`)
      }
    }
    log.blank()

    if (plan.api_contracts && plan.api_contracts.length > 0) {
      log.info(`接口契约: ${plan.api_contracts.map(c => c.name).join(', ')}`)
    }
    log.info(`合并顺序: ${plan.merge_order.join(' → ')}`)
    log.blank()
  }

  private printReport(cp: ReturnType<CheckpointManager['load']>, results: Array<{ taskId: string; success?: boolean; duration?: number }>): void {
    if (!cp) return
    log.header('📊 执行报告')
    log.table([
      ['需求', cp.requirement],
      ['状态', cp.status],
      ['模型', cp.model],
      ['基准分支', cp.base_branch],
    ])
    log.blank()

    for (const task of cp.tasks) {
      const icon = task.status === 'completed' ? '✅' : task.status === 'failed' ? '❌' : '⏳'
      const result = results.find(r => r.taskId === task.id)
      const duration = result?.duration ? ` (${Math.round(result.duration / 1000)}s)` : ''
      log.info(`${icon} [${task.role}] ${task.title}${duration}`)
    }
    log.blank()
  }
}
