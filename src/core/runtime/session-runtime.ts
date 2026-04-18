import type {
  AuditRecord,
  ContractArtifact,
  ExecutionSession,
  ExecutionSummaryReport,
  McpNode,
  PreflightReport,
  ProjectDiscovery,
  RequirementDraft,
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
import { TaskGraphBuilder } from '../scheduler/task-graph.js'

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
    const session = this.store.loadSession()
    if (!session) return null

    const normalized = this.normalizeSessionContracts(session)
    if (JSON.stringify(normalized.contracts) !== JSON.stringify(session.contracts)) {
      this.store.saveSession(normalized)
    }
    return normalized
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

  saveRequirementDraft(requirement: string): RequirementDraft {
    return this.store.saveRequirementDraft(requirement)
  }

  loadRequirementDraft(): RequirementDraft | null {
    return this.store.loadRequirementDraft()
  }

  clearRequirementDraft(): void {
    this.store.clearRequirementDraft()
  }

  async buildStartupFlow(): Promise<StartupFlowState> {
    const scanner = new PreflightScanner()
    const discovery = this.buildProjectDiscovery()
    const config = scanner.scanConfig(this.projectRoot)
    const preflight = await scanner.scan(this.projectRoot)
    const completeness = scanner.scanCompleteness(this.projectRoot)

    const recentSessions = this.store.listSessionHistory()
    const templates = this.store.listStartupTemplates()
    const requirementDraft = this.store.loadRequirementDraft()
    const requirementAnalysis = requirementDraft
      ? new TaskGraphBuilder().build(requirementDraft.requirement, this.projectRoot).analysis
      : undefined
    const activeSession = this.load()
    const requiresApproval = Boolean(activeSession && activeSession.phase === 'planning')
    const hasResumable = recentSessions.some(item => item.resumable) || (activeSession ? activeSession.phase !== 'completed' && activeSession.phase !== 'planning' : false)
    const canStartNew = discovery.hasGit && config.passed && preflight.passed && completeness.status !== 'blocked' && !requiresApproval

    const entries = {
      approve: requiresApproval
        ? { available: true }
        : { available: false, reason: '当前没有待审批的 planning session。' },
      newSession: canStartNew
        ? { available: true }
        : { available: false, reason: requiresApproval ? '当前已有待审批 session，需先 approve 再执行。' : '存在未通过的 discovery/config/preflight/completeness 项，需要先修复。' },
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
        key: 'completeness',
        title: 'Project completeness',
        status: completeness.status === 'ready' ? 'completed' : completeness.status === 'warning' ? 'warning' : 'failed',
        message: completeness.summary,
        blocking: completeness.status === 'blocked',
        nextStep: completeness.hardBlockers.length > 0 ? completeness.hardBlockers[0] : completeness.suggestions[0],
      },
      {
        key: 'requirement',
        title: 'Requirement input',
        status: requirementDraft ? 'completed' : canStartNew ? 'ready' : 'warning',
        message: requirementDraft
          ? `已记录需求：${requirementDraft.requirement}`
          : canStartNew
            ? '当前可录入本轮项目需求。'
            : '当前还不能录入需求并进入 planning。',
        blocking: false,
        nextStep: requirementDraft
          ? '运行 parallel_start 生成主控分析与执行计划。'
          : canStartNew
            ? '运行 parallel_requirement 先保存需求。'
            : undefined,
      },
      {
        key: 'launch',
        title: 'Launch readiness',
        status: requiresApproval ? 'warning' : canStartNew ? 'ready' : 'warning',
        message: requiresApproval
          ? '当前已有 planning session，需先审批后才能进入执行。'
          : canStartNew
            ? '可以直接启动新 session。'
            : '先处理 warning/failed 项，再启动新 session。',
        blocking: !canStartNew,
        nextStep: requiresApproval ? '运行 parallel_approve 进入主控执行。' : undefined,
      },
    ]

    const recommendedEntry: StartupFlowState['recommendedEntry'] = requiresApproval
      ? 'approve'
      : entries.resume.available
        ? 'resume'
        : entries.newSession.available
          ? 'new'
          : 'template'
    const shouldInitFirst = !discovery.initialized
    const developmentStatus: StartupFlowState['developmentStatus'] = requiresApproval
      ? 'approval_required'
      : entries.resume.available
        ? 'resumable'
        : canStartNew && !shouldInitFirst
          ? 'ready'
          : 'blocked'
    const canAcceptRequirement = developmentStatus === 'ready'
    const requirementPrompt = requirementDraft
      ? `已录入需求，可直接 planning：${requirementDraft.requirement}`
      : canAcceptRequirement
        ? '已连接并可开始开发。先运行 parallel_requirement 录入本轮项目需求，再调用 parallel_start。'
        : undefined
    const summary = !discovery.hasGit
      ? '当前目录还不是可用的 Git 项目，先修正项目根目录。'
      : requiresApproval
        ? '检测到待审批的 planning session，先确认执行计划再进入主控执行。'
        : entries.resume.available
          ? '检测到可恢复 session，优先回到已有工作流继续推进。'
          : completeness.status === 'blocked'
            ? '当前项目完整度存在硬阻塞，先补齐基础模块再进入 planning。'
            : shouldInitFirst
              ? '当前仓库还没完成 parallel 平台初始化，建议先补齐基础结构再启动 session。'
              : !requirementDraft
                ? '当前项目已准备就绪，下一步先录入项目需求。'
                : entries.newSession.available
                  ? '当前项目与需求都已准备就绪，可以生成新的并行计划。'
                  : entries.template.available
                    ? '当前不适合直接启动，先从模板或修复建议入手。'
                    : '当前项目还有阻塞项，先处理 startup / preflight 提示。'
    const recommendedAction = requiresApproval
      ? 'parallel_approve'
      : entries.resume.available
        ? 'parallel_resume'
        : shouldInitFirst
          ? 'parallel_init'
          : completeness.status === 'blocked'
            ? 'parallel_preflight'
            : !requirementDraft && entries.newSession.available
              ? 'parallel_requirement'
              : recommendedEntry === 'new'
                ? 'parallel_start'
                : 'parallel_init'
    const recommendedReason = requiresApproval
      ? '已有需求拆解与任务分配结果，先审批后执行可保持主控流清晰。'
      : entries.resume.available
        ? '已有未完成 session，可直接恢复当前进度。'
        : shouldInitFirst
          ? '当前仓库缺少 parallel 平台目录或基础初始化文件，先初始化更稳妥。'
          : completeness.status === 'blocked'
            ? '项目关键模块缺失，先做完整度修复比直接派发任务更稳妥。'
            : !requirementDraft && entries.newSession.available
              ? '主控 planning 前需要先拿到本轮明确需求。'
              : recommendedEntry === 'new'
                ? 'discovery、config、preflight、completeness 与 requirement 已满足启动条件。'
                : entries.template.reason || entries.newSession.reason || '当前更适合先初始化或修复阻塞项。'
    const nextActions = [
      recommendedAction,
      ...(requiresApproval ? ['parallel_dashboard'] : []),
      ...(!discovery.initialized ? ['parallel_init'] : []),
      ...(!config.passed || !preflight.passed || completeness.status !== 'ready' ? ['parallel_preflight'] : []),
      ...(!requirementDraft && entries.newSession.available ? ['parallel_requirement'] : []),
      ...(requirementDraft && entries.newSession.available && recommendedAction !== 'parallel_start' ? ['parallel_start'] : []),
      ...(entries.resume.available && !requiresApproval ? ['parallel_dashboard'] : []),
    ].filter((action, index, list) => list.indexOf(action) === index)

    return {
      projectRoot: this.projectRoot,
      discovery,
      config,
      preflight,
      completeness,
      recentSessions,
      templates,
      requirementDraft,
      requirementAnalysis,
      entries,
      connectionStatus: 'connected',
      developmentStatus,
      canAcceptRequirement,
      requirementPrompt,
      recommendedEntry,
      summary,
      recommendedAction,
      recommendedReason,
      nextActions,
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

  private normalizeSessionContracts(session: ExecutionSession): ExecutionSession {
    const fallbackProducerTaskId = session.taskGraph.tasks.find(task => task.roleType === 'architect' || task.roleType === 'developer')?.id
      || session.taskGraph.tasks[0]?.id
      || 'manual'
    const fallbackConsumerTaskIds = session.taskGraph.tasks
      .map(task => task.id)
      .filter(taskId => taskId !== fallbackProducerTaskId)

    return {
      ...session,
      contracts: session.contracts.map(contract => {
        const producerTaskId = contract.producerTaskId !== 'manual' && contract.producerTaskId
          ? contract.producerTaskId
          : fallbackProducerTaskId
        const consumerTaskIds = contract.consumerTaskIds.length > 0
          ? contract.consumerTaskIds
          : fallbackConsumerTaskIds
        const content = normalizeContractContent(contract, producerTaskId)

        return {
          ...contract,
          producerTaskId,
          consumerTaskIds,
          content,
          validationStatus: contract.validationStatus === 'invalid' ? 'invalid' : 'valid',
        }
      }),
    }
  }
}

function normalizeContractContent(contract: ContractArtifact, producerTaskId: string): string {
  try {
    const parsed = JSON.parse(contract.content) as {
      ownerTaskId?: string
      version?: number
      summary?: string
      kind?: 'delivery' | 'api'
    }

    return JSON.stringify({
      ownerTaskId: producerTaskId,
      version: contract.version,
      summary: parsed.summary || contract.name || 'migrated contract',
      kind: parsed.kind === 'api' ? 'api' : 'delivery',
    })
  } catch {
    return JSON.stringify({
      ownerTaskId: producerTaskId,
      version: contract.version,
      summary: contract.content || contract.name || 'migrated contract',
      kind: 'delivery',
    })
  }
}

function normalizeStartupStatus(status: 'passed' | 'warning' | 'failed'): 'completed' | 'ready' | 'warning' | 'failed' {
  if (status === 'passed') return 'completed'
  if (status === 'warning') return 'warning'
  return 'failed'
}
