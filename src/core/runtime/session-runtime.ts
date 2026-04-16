import type {
  AuditRecord,
  ExecutionSession,
  ExecutionSummaryReport,
  McpNode,
  PreflightReport,
  ProjectDiscovery,
  StartupFlowState,
  StartupFlowStep,
  TaskGraph,
  TelemetryEvent,
} from '../../types.js'
import { SessionStore } from './session-store.js'
import { ResumeRebuilder } from './resume-rebuilder.js'
import { detectTechStack, getGitInfo, hasClaudeMd, hasMcpConfig, hasParallelPlatform } from '../../utils/platform.js'
import { PreflightScanner } from '../preflight/preflight-scanner.js'
import { appendAuditRecords, createAuditRecord } from '../telemetry/audit-trail.js'

export class SessionRuntime {
  private store: SessionStore
  private rebuilder = new ResumeRebuilder()

  constructor(private projectRoot: string) {
    this.store = new SessionStore(projectRoot)
  }

  create(requirement: string, mcps: McpNode[], taskGraph: TaskGraph, preflight?: PreflightReport): ExecutionSession {
    const git = getGitInfo(this.projectRoot)
    const stack = detectTechStack(this.projectRoot).frameworks
    const now = new Date().toISOString()
    const sessionId = `session-${Date.now()}`
    const session: ExecutionSession = {
      sessionId,
      projectRoot: this.projectRoot,
      requirement,
      baseBranch: git.branch || 'main',
      controllerMcpId: mcps[0]?.id || 'MCP-01',
      phase: preflight?.passed === false ? 'failed' : 'planning',
      createdAt: now,
      updatedAt: now,
      stack,
      mcps,
      taskGraph,
      contracts: [],
      preflight,
      auditTrail: [
        createAuditRecord({
          sessionId,
          scope: 'startup',
          action: 'create-session',
          status: preflight?.passed === false ? 'failed' : 'passed',
          actor: mcps[0]?.id || 'MCP-01',
          message: `session created for requirement: ${requirement}`,
          metadata: {
            projectRoot: this.projectRoot,
            baseBranch: git.branch || 'main',
            stack: stack.join(', ') || 'unknown',
          },
        }),
      ],
      telemetry: [],
      artifacts: {},
      resumeCursor: { phase: 'planning', taskIds: taskGraph.tasks.map(task => task.id) },
    }
    this.store.saveSession(session)
    return session
  }

  load(): ExecutionSession | null {
    return this.store.loadSession()
  }

  save(session: ExecutionSession): void {
    this.store.saveSession({ ...session, updatedAt: new Date().toISOString() })
  }

  resume(): ExecutionSession | null {
    const session = this.load()
    if (!session) return null
    const rebuilt = this.appendAudit(this.rebuilder.rebuild(session), [
      createAuditRecord({
        sessionId: session.sessionId,
        scope: 'session',
        action: 'resume-session',
        status: 'passed',
        actor: session.controllerMcpId,
        message: 'session resumed from persisted state',
      }),
    ])
    this.save(rebuilt)
    return rebuilt
  }

  appendTelemetry(session: ExecutionSession, event: TelemetryEvent): ExecutionSession {
    const updated = {
      ...session,
      telemetry: [...session.telemetry, event],
      updatedAt: new Date().toISOString(),
    }
    this.store.saveSession(updated)
    return updated
  }

  appendAudit(session: ExecutionSession, records: AuditRecord[]): ExecutionSession {
    const updated = {
      ...session,
      auditTrail: appendAuditRecords(session.auditTrail || [], records),
      updatedAt: new Date().toISOString(),
    }
    this.store.saveSession(updated)
    return updated
  }

  saveReport(report: ExecutionSummaryReport): void {
    this.store.saveReport(report)
  }

  async buildStartupFlow(): Promise<StartupFlowState> {
    const scanner = new PreflightScanner()
    const discovery = this.buildProjectDiscovery()
    const config = scanner.scanConfig(this.projectRoot)
    const preflight = await scanner.scan(this.projectRoot)

    const recentSessions = this.store.listSessionHistory()
    const templates = this.store.listStartupTemplates()
    const activeSession = this.load()
    const hasResumable = recentSessions.some(item => item.resumable) || (activeSession ? activeSession.phase !== 'completed' : false)
    const canStartNew = discovery.hasGit && config.passed && preflight.passed

    const entries = {
      newSession: canStartNew
        ? { available: true }
        : { available: false, reason: '存在未通过的 discovery/config/preflight 项，需要先修复。' },
      resume: hasResumable
        ? { available: true }
        : { available: false, reason: '当前没有可继续的 session。' },
      template: templates.length > 0
        ? { available: true }
        : { available: false, reason: '当前没有可用模板。' },
    }

    const steps: StartupFlowStep[] = [
      {
        key: 'discovery',
        title: 'Project discovery',
        status: discovery.hasGit ? 'completed' : 'failed',
        message: discovery.hasGit ? `已识别项目根目录 ${discovery.root}` : '未识别到 Git 仓库。',
        blocking: !discovery.hasGit,
        nextStep: discovery.hasGit ? undefined : '切换到正确项目根目录后重试。',
      },
      ...config.checks.map(check => ({
        key: `config:${check.name}`,
        title: `Config ${check.name}`,
        status: normalizeStartupStatus(check.status),
        message: check.message,
        blocking: check.status === 'failed',
        fixAction: check.fixAction,
        nextStep: check.nextStep,
      })),
      ...preflight.checks.map(check => ({
        key: `preflight:${check.name}`,
        title: `Preflight ${check.name}`,
        status: normalizeStartupStatus(check.status),
        message: check.message,
        blocking: check.status === 'failed',
        fixAction: check.fixAction,
        nextStep: check.nextStep,
      })),
      {
        key: 'launch',
        title: 'Launch readiness',
        status: canStartNew ? 'ready' : 'warning',
        message: canStartNew ? '可以直接启动新 session。' : '先处理 warning/failed 项，再启动新 session。',
        blocking: !canStartNew,
      },
    ]

    return {
      projectRoot: this.projectRoot,
      discovery,
      config,
      preflight,
      recentSessions,
      templates,
      entries,
      recommendedEntry: entries.resume.available ? 'resume' : entries.newSession.available ? 'new' : 'template',
      steps,
    }
  }

  private buildProjectDiscovery(): ProjectDiscovery {
    const git = getGitInfo(this.projectRoot)
    return {
      root: this.projectRoot,
      initialized: hasParallelPlatform(this.projectRoot),
      hasGit: Boolean(git.branch || git.head),
      hasClaudeMd: hasClaudeMd(this.projectRoot),
      hasMcpConfig: hasMcpConfig(this.projectRoot),
      hasParallelDir: hasParallelPlatform(this.projectRoot),
      stack: detectTechStack(this.projectRoot).frameworks,
    }
  }
}

function normalizeStartupStatus(status: 'passed' | 'warning' | 'failed'): 'completed' | 'ready' | 'warning' | 'failed' {
  if (status === 'passed') return 'completed'
  if (status === 'warning') return 'warning'
  return 'failed'
}
