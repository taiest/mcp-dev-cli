import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContextCache, ContextSummary, ContextRestoreResult } from '../types.js'
import { CACHE_DIR, CACHE_INDEX_FILE, LATEST_CACHE_FILE, LOCAL_CACHE_ROOT_NAME } from '../types.js'
import { getGitInfo, getLocalProjectCacheDir, getProjectHash } from '../utils/platform.js'

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export class CacheStore {
  private projectRoot: string
  private projectCacheDir: string
  private localCacheDir: string
  private projectHash: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.projectCacheDir = join(projectRoot, CACHE_DIR)
    this.localCacheDir = getLocalProjectCacheDir(projectRoot)
    this.projectHash = getProjectHash(projectRoot)
  }

  ensure(): void {
    ensureDir(this.projectCacheDir)
    ensureDir(join(this.projectCacheDir, 'snapshots'))
    ensureDir(this.localCacheDir)
    ensureDir(join(this.localCacheDir, 'snapshots'))

    const projectIndex = join(this.projectRoot, CACHE_INDEX_FILE)
    if (!existsSync(projectIndex)) {
      writeFileSync(projectIndex, JSON.stringify({ projectHash: this.projectHash, snapshots: [] }, null, 2), 'utf-8')
    }
  }

  save(summary: ContextSummary, reason = 'manual', extra?: Partial<ContextCache>): ContextCache {
    this.ensure()
    const git = getGitInfo(this.projectRoot)
    const cache: ContextCache = {
      schemaVersion: 1,
      projectRoot: this.projectRoot,
      projectHash: this.projectHash,
      updatedAt: new Date().toISOString(),
      git,
      analysis: summary,
      execution: {
        phase: summary.phase || extra?.execution?.phase || 'planning',
        checkpointStatus: extra?.execution?.checkpointStatus || '',
        agents: extra?.execution?.agents || [],
        lastResult: extra?.execution?.lastResult || '',
      },
      files: extra?.files || {
        sessionBrief: '.claude/context/session-brief.md',
        productContext: '.claude/context/product-context.md',
        screenshotAnalysis: '.claude/context/screenshot-analysis.md',
        implementationPlan: '.claude/context/implementation-plan.md',
        discoveredRisks: '.claude/context/discovered-risks.md',
        executionHandoff: '.claude/context/execution-handoff.md',
      },
    }

    const timestamp = cache.updatedAt.replace(/[:.]/g, '-')
    const snapshotName = `${timestamp}-${reason}.json`
    const projectLatest = join(this.projectRoot, LATEST_CACHE_FILE)
    const localLatest = join(this.localCacheDir, 'latest-context.json')

    writeFileSync(projectLatest, JSON.stringify(cache, null, 2), 'utf-8')
    writeFileSync(localLatest, JSON.stringify(cache, null, 2), 'utf-8')
    writeFileSync(join(this.projectCacheDir, 'snapshots', snapshotName), JSON.stringify(cache, null, 2), 'utf-8')
    writeFileSync(join(this.localCacheDir, 'snapshots', snapshotName), JSON.stringify(cache, null, 2), 'utf-8')
    writeFileSync(
      join(this.localCacheDir, 'latest-session-meta.json'),
      JSON.stringify({ updatedAt: cache.updatedAt, source: reason, projectRoot: this.projectRoot }, null, 2),
      'utf-8'
    )

    this.updateIndex(snapshotName)
    return cache
  }

  loadProjectLatest(): ContextCache | null {
    return this.loadJson(join(this.projectRoot, LATEST_CACHE_FILE))
  }

  loadLocalLatest(): ContextCache | null {
    return this.loadJson(join(this.localCacheDir, 'latest-context.json'))
  }

  loadBestAvailable(): ContextRestoreResult | null {
    const project = this.loadProjectLatest()
    if (project) {
      return { source: 'project-cache', summaryText: buildSummaryText(project.analysis), cache: project.analysis, contextCache: project }
    }

    const local = this.loadLocalLatest()
    if (local) {
      return { source: 'local-cache', summaryText: buildSummaryText(local.analysis), cache: local.analysis, contextCache: local }
    }

    const latestSnapshot = this.loadLatestSnapshot()
    if (latestSnapshot) {
      return { source: 'snapshot', summaryText: buildSummaryText(latestSnapshot.analysis), cache: latestSnapshot.analysis, contextCache: latestSnapshot }
    }

    return null
  }

  private loadLatestSnapshot(): ContextCache | null {
    const snapshotDir = join(this.localCacheDir, 'snapshots')
    if (!existsSync(snapshotDir)) return null
    const files = readdirSync(snapshotDir).filter(file => file.endsWith('.json')).sort().reverse()
    if (files.length === 0) return null
    return this.loadJson(join(snapshotDir, files[0]!))
  }

  private loadJson(filePath: string): ContextCache | null {
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as ContextCache
    } catch {
      return null
    }
  }

  private updateIndex(snapshotName: string): void {
    const indexPath = join(this.projectRoot, CACHE_INDEX_FILE)
    const existing = this.safeReadIndex(indexPath)
    const snapshots = [snapshotName, ...(existing?.snapshots || [])].slice(0, 10)
    writeFileSync(indexPath, JSON.stringify({ projectHash: this.projectHash, localRoot: LOCAL_CACHE_ROOT_NAME, snapshots }, null, 2), 'utf-8')
  }

  private safeReadIndex(filePath: string): { projectHash?: string; snapshots?: string[] } | null {
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as { projectHash?: string; snapshots?: string[] }
    } catch {
      return null
    }
  }
}

function buildSummaryText(summary: ContextSummary): string {
  const lines: string[] = ['## 已恢复缓存上下文']
  if (summary.goal) lines.push(`- 当前目标: ${summary.goal}`)
  if (summary.phase) lines.push(`- 当前阶段: ${summary.phase}`)
  if (summary.constraints.length > 0) lines.push(`- 已确认约束: ${summary.constraints.join('；')}`)
  if (summary.risks.length > 0) lines.push(`- 已知风险: ${summary.risks.join('；')}`)
  if (summary.nextSteps.length > 0) lines.push(`- 下一步建议: ${summary.nextSteps.join('；')}`)
  return lines.join('\n')
}
