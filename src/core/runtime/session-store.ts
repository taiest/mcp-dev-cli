import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuditRecord, ContextIndex, ExecutionSession, ExecutionSummaryReport, RequirementDraft, SessionHistoryEntry, StartupTemplate, TaskContextSnapshot } from '../../types.js'
import { PARALLEL_AUDIT_FILE, PARALLEL_CONTEXT_DIR, PARALLEL_CONTRACTS_FILE, PARALLEL_DIR, PARALLEL_REPORT_FILE, PARALLEL_REQUIREMENT_FILE, PARALLEL_SESSION_FILE, PARALLEL_TELEMETRY_FILE } from '../../types.js'

const STARTUP_TEMPLATES: StartupTemplate[] = [
  {
    id: 'feature-delivery',
    title: '新功能交付',
    description: '适合新增模块、接口或完整功能开发。',
    requirement: '实现一个可交付的新功能，包含设计、开发、测试、review 和 merge。',
  },
  {
    id: 'bugfix-hardening',
    title: '问题修复与加固',
    description: '适合线上问题修复、回归验证与风险兜底。',
    requirement: '修复当前问题，补齐验证与质量门禁，确保可安全恢复和继续推进。',
  },
  {
    id: 'refactor-governed',
    title: '受控重构',
    description: '适合多角色协同的重构、契约校验与质量复审。',
    requirement: '在不偏移技术栈的前提下完成重构，并保留契约、review 与 resume continuity。',
  },
]

export class SessionStore {
  constructor(private projectRoot: string) {}

  private ensureParent(filePath: string): void {
    mkdirSync(dirname(filePath), { recursive: true })
  }

  sessionFile(): string {
    return join(this.projectRoot, PARALLEL_SESSION_FILE)
  }

  contractsFile(): string {
    return join(this.projectRoot, PARALLEL_CONTRACTS_FILE)
  }

  telemetryFile(): string {
    return join(this.projectRoot, PARALLEL_TELEMETRY_FILE)
  }

  reportFile(): string {
    return join(this.projectRoot, PARALLEL_REPORT_FILE)
  }

  requirementFile(): string {
    return join(this.projectRoot, PARALLEL_REQUIREMENT_FILE)
  }

  auditFile(): string {
    return join(this.projectRoot, PARALLEL_AUDIT_FILE)
  }

  historyFile(): string {
    return join(this.projectRoot, PARALLEL_DIR, 'history.json')
  }

  saveSession(session: ExecutionSession): void {
    this.ensureParent(this.sessionFile())
    writeFileSync(this.sessionFile(), JSON.stringify(session, null, 2), 'utf-8')
    writeFileSync(this.contractsFile(), JSON.stringify(session.contracts, null, 2), 'utf-8')
    writeFileSync(this.telemetryFile(), JSON.stringify(session.telemetry, null, 2), 'utf-8')
    writeFileSync(this.auditFile(), JSON.stringify(session.auditTrail || [], null, 2), 'utf-8')
    this.saveHistoryEntry(session)
  }

  loadSession(): ExecutionSession | null {
    if (!existsSync(this.sessionFile())) return null
    try {
      return JSON.parse(readFileSync(this.sessionFile(), 'utf-8')) as ExecutionSession
    } catch {
      return null
    }
  }

  saveAuditTrail(records: AuditRecord[]): void {
    this.ensureParent(this.auditFile())
    writeFileSync(this.auditFile(), JSON.stringify(records, null, 2), 'utf-8')
  }

  saveReport(report: ExecutionSummaryReport): void {
    this.ensureParent(this.reportFile())
    writeFileSync(this.reportFile(), JSON.stringify(report, null, 2), 'utf-8')
  }

  saveRequirementDraft(requirement: string): RequirementDraft {
    const draft: RequirementDraft = {
      requirement,
      capturedAt: new Date().toISOString(),
      source: 'tool',
    }
    this.ensureParent(this.requirementFile())
    writeFileSync(this.requirementFile(), JSON.stringify(draft, null, 2), 'utf-8')
    return draft
  }

  loadRequirementDraft(): RequirementDraft | null {
    if (!existsSync(this.requirementFile())) return null
    try {
      return JSON.parse(readFileSync(this.requirementFile(), 'utf-8')) as RequirementDraft
    } catch {
      return null
    }
  }

  clearRequirementDraft(): void {
    if (!existsSync(this.requirementFile())) return
    rmSync(this.requirementFile())
  }

  listSessionHistory(limit = 5): SessionHistoryEntry[] {
    if (!existsSync(this.historyFile())) return []
    try {
      const history = JSON.parse(readFileSync(this.historyFile(), 'utf-8')) as SessionHistoryEntry[]
      return history
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit)
    } catch {
      return []
    }
  }

  listStartupTemplates(): StartupTemplate[] {
    return STARTUP_TEMPLATES
  }

  private saveHistoryEntry(session: ExecutionSession): void {
    const history = this.listSessionHistory(50).filter(item => item.sessionId !== session.sessionId)
    const next: SessionHistoryEntry = {
      sessionId: session.sessionId,
      requirement: session.requirement,
      phase: session.phase,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      controllerMcpId: session.controllerMcpId,
      resumable: session.phase !== 'completed',
    }
    this.ensureParent(this.historyFile())
    writeFileSync(this.historyFile(), JSON.stringify([next, ...history].slice(0, 50), null, 2), 'utf-8')
  }

  // ─── Context Cache ─────────────────────────────────────

  private contextDir(): string {
    return join(this.projectRoot, PARALLEL_CONTEXT_DIR)
  }

  private contextIndexFile(): string {
    return join(this.contextDir(), 'index.json')
  }

  saveTaskContext(snapshot: TaskContextSnapshot): void {
    const dir = join(this.contextDir(), snapshot.mcpId)
    mkdirSync(dir, { recursive: true })
    const ts = snapshot.timestamp.replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d+)/, '$1-$2')
    const file = `${snapshot.taskId}_${ts}.json`
    writeFileSync(join(dir, file), JSON.stringify(snapshot, null, 2), 'utf-8')

    const index = this.loadContextIndex()
    index.push({
      mcpId: snapshot.mcpId,
      taskId: snapshot.taskId,
      file: `${snapshot.mcpId}/${file}`,
      title: snapshot.title,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
      tokens: snapshot.tokens,
    })
    writeFileSync(this.contextIndexFile(), JSON.stringify(index, null, 2), 'utf-8')
  }

  loadContextIndex(): ContextIndex[] {
    if (!existsSync(this.contextIndexFile())) return []
    try {
      return JSON.parse(readFileSync(this.contextIndexFile(), 'utf-8')) as ContextIndex[]
    } catch {
      return []
    }
  }

  loadTaskContext(mcpId: string, taskId: string): TaskContextSnapshot | null {
    const index = this.loadContextIndex()
    const entries = index.filter(e => e.mcpId === mcpId && e.taskId === taskId)
    if (entries.length === 0) return null
    const latest = entries[entries.length - 1]
    const filePath = join(this.contextDir(), latest.file)
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as TaskContextSnapshot
    } catch {
      return null
    }
  }

  listMcpContexts(mcpId: string): TaskContextSnapshot[] {
    const dir = join(this.contextDir(), mcpId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => {
        try { return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as TaskContextSnapshot } catch { return null }
      })
      .filter((s): s is TaskContextSnapshot => s !== null)
  }

  loadContextByTimestamp(timestamp: string): TaskContextSnapshot[] {
    const index = this.loadContextIndex()
    return index
      .filter(e => e.createdAt <= timestamp)
      .map(e => {
        const filePath = join(this.contextDir(), e.file)
        if (!existsSync(filePath)) return null
        try { return JSON.parse(readFileSync(filePath, 'utf-8')) as TaskContextSnapshot } catch { return null }
      })
      .filter((s): s is TaskContextSnapshot => s !== null)
  }
}
