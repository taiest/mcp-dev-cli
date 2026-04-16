import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuditRecord, ExecutionSession, ExecutionSummaryReport, SessionHistoryEntry, StartupTemplate } from '../../types.js'
import { PARALLEL_AUDIT_FILE, PARALLEL_CONTRACTS_FILE, PARALLEL_DIR, PARALLEL_REPORT_FILE, PARALLEL_SESSION_FILE, PARALLEL_TELEMETRY_FILE } from '../../types.js'

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
}
