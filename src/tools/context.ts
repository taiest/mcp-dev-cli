import { ContextStore } from '../core/context-store.js'
import { CacheStore } from '../core/cache-store.js'
import type { ContextSummary } from '../types.js'
import { findProjectRoot } from '../utils/platform.js'

function normalizeSummary(input: {
  goal: string
  constraints?: string[]
  analysis?: string
  plan?: string
  risks?: string[]
  nextSteps?: string[]
  phase?: string
}): ContextSummary {
  return {
    goal: input.goal,
    constraints: input.constraints || [],
    analysis: input.analysis || '',
    plan: input.plan || '',
    risks: input.risks || [],
    nextSteps: input.nextSteps || [],
    phase: input.phase || 'planning',
  }
}

export function saveContext(input: {
  projectRoot?: string
  goal: string
  constraints?: string[]
  analysis?: string
  plan?: string
  risks?: string[]
  nextSteps?: string[]
  phase?: string
}): string {
  const projectRoot = input.projectRoot || findProjectRoot()
  const summary = normalizeSummary(input)
  const contextStore = new ContextStore(projectRoot)
  const cacheStore = new CacheStore(projectRoot)

  const written = contextStore.save(summary)
  const cache = cacheStore.save(summary, 'context-save')

  return [
    '✅ 上下文已保存',
    `项目: ${projectRoot}`,
    `更新时间: ${cache.updatedAt}`,
    `写入文件: ${written.join(', ') || '无'}`,
    '已同步写入项目 cache 与本地 cache',
  ].join('\n')
}

export function loadContext(projectRoot?: string, preferLocalCache = false): string {
  const root = projectRoot || findProjectRoot()
  const contextStore = new ContextStore(root)
  const cacheStore = new CacheStore(root)

  const context = contextStore.load()
  if (context && !preferLocalCache) {
    return ['✅ 已从项目 context 恢复', contextStore.buildSummaryText(context)].filter(Boolean).join('\n\n')
  }

  const restored = cacheStore.loadBestAvailable()
  if (restored) {
    return [`✅ 已从${restored.source}恢复`, restored.summaryText].filter(Boolean).join('\n\n')
  }

  return '当前没有可恢复的上下文。'
}

export function snapshotContext(projectRoot?: string, reason = 'manual-snapshot'): string {
  const root = projectRoot || findProjectRoot()
  const contextStore = new ContextStore(root)
  const cacheStore = new CacheStore(root)
  const context = contextStore.load()

  if (!context) {
    return '当前没有可快照的上下文。请先执行 mcp_dev_context_save。'
  }

  const cache = cacheStore.save(context, reason)
  return [
    '✅ 上下文快照已创建',
    `项目: ${root}`,
    `更新时间: ${cache.updatedAt}`,
    `原因: ${reason}`,
  ].join('\n')
}

export function restoreContext(projectRoot?: string, preferLocalCache = false): string {
  const root = projectRoot || findProjectRoot()
  const contextStore = new ContextStore(root)
  const cacheStore = new CacheStore(root)

  const context = !preferLocalCache ? contextStore.load() : null
  if (context) {
    return ['✅ 已从项目 context 恢复', contextStore.buildSummaryText(context)].join('\n\n')
  }

  const restored = cacheStore.loadBestAvailable()
  if (!restored) {
    return '当前没有可恢复的上下文或缓存。'
  }

  if (restored.cache) {
    contextStore.save(restored.cache)
  }

  return [`✅ 已恢复到项目 context（来源: ${restored.source}）`, restored.summaryText].join('\n\n')
}
