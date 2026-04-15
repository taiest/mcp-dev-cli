import { execa } from 'execa'
import type { WorkerResult, Config } from '../types.js'
import { log } from '../utils/logger.js'
import { GitManager } from './git-manager.js'
import { runClaude } from '../utils/claude-cli.js'
import { getBuildCommands } from '../utils/platform.js'

export class Merger {
  private git: GitManager
  private config: Config

  constructor(config: Config) {
    this.config = config
    this.git = new GitManager(config.projectRoot)
  }

  async mergeAll(results: WorkerResult[], mergeOrder: string[], baseBranch: string): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = []
    const successResults = results.filter(r => r.success)

    // 按 merge_order 排序
    const ordered = mergeOrder
      .map(id => successResults.find(r => r.taskId === id))
      .filter((r): r is WorkerResult => r !== undefined)

    // 加上不在 merge_order 中的（兜底）
    for (const r of successResults) {
      if (!ordered.find(o => o.taskId === r.taskId)) {
        ordered.push(r)
      }
    }

    log.header('合并阶段')
    await this.git.checkout(baseBranch)

    for (const result of ordered) {
      log.git(`合并 ${result.branch} → ${baseBranch}`)
      const mergeResult = await this.git.merge(result.branch, baseBranch)

      if (!mergeResult.success) {
        if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
          log.warn(`冲突文件: ${mergeResult.conflicts.join(', ')}`)
          log.info('尝试 AI 自动解决冲突...')

          const resolved = await this.resolveConflictsWithAI(mergeResult.conflicts)
          if (!resolved) {
            await this.git.abortMerge()
            errors.push(`${result.branch}: 冲突无法自动解决`)
            continue
          }
        } else {
          errors.push(`${result.branch}: ${mergeResult.error}`)
          continue
        }
      }
    }

    return { success: errors.length === 0, errors }
  }

  private async resolveConflictsWithAI(conflictFiles: string[]): Promise<boolean> {
    try {
      const prompt = `以下文件存在 Git 合并冲突，请解决所有冲突。保留两边的有效代码，确保逻辑正确。

冲突文件: ${conflictFiles.join(', ')}

请读取这些文件，解决冲突标记（<<<<<<<, =======, >>>>>>>），然后保存。完成后运行编译检查。`

      await runClaude({
        prompt,
        model: this.config.model,
        allowedTools: 'Read,Write,Edit,Bash',
        cwd: this.config.projectRoot,
        noSessionPersistence: true,
      })

      // 标记冲突已解决
      await execa('git', ['add', ...conflictFiles], { cwd: this.config.projectRoot })
      await execa('git', ['commit', '--no-edit'], { cwd: this.config.projectRoot })

      log.success('AI 冲突解决成功')
      return true
    } catch (e) {
      log.error(`AI 冲突解决失败: ${(e as Error).message}`)
      return false
    }
  }

  async verify(): Promise<{ success: boolean; errors: string[] }> {
    log.header('编译验证')
    const commands = getBuildCommands(this.config.projectRoot)
    const errors: string[] = []

    if (commands.length === 0) {
      log.warn('未检测到编译命令，跳过验证')
      return { success: true, errors: [] }
    }

    for (const cmd of commands) {
      log.info(`运行: ${cmd}`)
      const [bin, ...args] = cmd.split(' ')
      const result = await execa(bin!, args, {
        cwd: this.config.projectRoot,
        reject: false,
        shell: true,
      })

      if (result.exitCode !== 0) {
        log.error(`验证失败: ${cmd}`)
        errors.push(`${cmd}: ${result.stderr?.slice(0, 300)}`)
      } else {
        log.success(`通过: ${cmd}`)
      }
    }

    return { success: errors.length === 0, errors }
  }

  async fixBuildErrors(errors: string[]): Promise<boolean> {
    log.info('尝试 AI 自动修复编译错误...')
    try {
      const prompt = `以下编译错误需要修复:\n\n${errors.join('\n\n')}\n\n请分析错误原因并修复代码。`

      await runClaude({
        prompt,
        model: this.config.model,
        allowedTools: 'Read,Write,Edit,Bash,Grep,Glob',
        cwd: this.config.projectRoot,
        noSessionPersistence: true,
      })

      // 重新验证
      const result = await this.verify()
      return result.success
    } catch {
      return false
    }
  }

  async cleanupBranches(): Promise<void> {
    log.git('清理任务分支...')
    await this.git.cleanupBranches()
  }
}
