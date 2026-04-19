// ─── 兼容层类型（待后续彻底移除） ─────────────────────────

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'
export type CheckpointStatus = 'planned' | 'branched' | 'executing' | 'merging' | 'completed' | 'delivered'

export interface TaskState {
  id: string
  role: string
  title: string
  description: string
  prompt: string
  branch: string
  files: string[]
  dependencies: string[]
  status: TaskStatus
  progress: string
  session_id?: string
  started_at?: string
  completed_at?: string
  error?: string
}

export interface Checkpoint {
  version: number
  session_id: string
  updated_at: string
  status: CheckpointStatus
  requirement: string
  model: string
  base_branch: string
  tasks: TaskState[]
  api_contracts: string[]
  merge_order: string[]
}

export interface ContextSummary {
  goal: string
  constraints: string[]
  analysis: string
  plan: string
  risks: string[]
  nextSteps: string[]
  phase: string
}

export interface ContextCache {
  schemaVersion: number
  projectRoot: string
  projectHash: string
  updatedAt: string
  git: {
    branch: string
    head: string
  }
  analysis: ContextSummary
  execution: {
    phase: string
    checkpointStatus: string
    agents: string[]
    lastResult: string
  }
  files: {
    sessionBrief: string
    productContext: string
    screenshotAnalysis: string
    implementationPlan: string
    discoveredRisks: string
    executionHandoff: string
  }
}

export interface ContextRestoreResult {
  source: 'context' | 'project-cache' | 'local-cache' | 'snapshot'
  summaryText: string
  cache: ContextSummary | null
  contextCache?: ContextCache
}

export interface TaskPlan {
  tasks: TaskDefinition[]
  merge_order: string[]
  api_contracts?: ApiContract[]
}

export interface TaskDefinition {
  id: string
  role: string
  title: string
  description: string
  prompt: string
  files: string[]
  dependencies: string[]
}

export interface ApiContract {
  name: string
  content: string
}

export interface AgentConfig {
  name: string
  description: string
  tools: string
  model: string
  color: string
  content: string
}

export interface WorkerResult {
  taskId: string
  branch: string
  success: boolean
  error?: string
  duration?: number
}

export interface MergeResult {
  success: boolean
  conflicts?: string[]
  error?: string
  mergeOrder?: string[]
  mergedBranches?: string[]
  failedBranches?: Array<{
    branch: string
    error?: string
  }>
}

export interface Config {
  model: string
  maxConcurrency: number
  projectRoot: string
  autoConfirm: boolean
  contextSummaryText?: string
}

export const DEFAULT_CONFIG: Config = {
  model: 'sonnet',
  maxConcurrency: 3,
  projectRoot: process.cwd(),
  autoConfirm: false,
  contextSummaryText: '',
}

export const AGENTS_DIR = '.claude/agents'
export const CONTEXT_DIR = '.claude/context'
export const CONTRACT_DIR = '.claude/context/api-contract'
export const CHECKPOINT_FILE = '.claude/context/task-checkpoint.json'
export const CACHE_DIR = '.claude/cache'
export const CACHE_INDEX_FILE = '.claude/cache/context-index.json'
export const LATEST_CACHE_FILE = '.claude/cache/latest-summary.json'
export const LOCAL_CACHE_ROOT_NAME = '.claude/mcp-dev-cli/cache'
export const BRANCH_PREFIX = 'mcp/'

export const CONTEXT_FILES = {
  sessionBrief: '.claude/context/session-brief.md',
  productContext: '.claude/context/product-context.md',
  screenshotAnalysis: '.claude/context/screenshot-analysis.md',
  implementationPlan: '.claude/context/implementation-plan.md',
  discoveredRisks: '.claude/context/discovered-risks.md',
  executionHandoff: '.claude/context/execution-handoff.md',
} as const

// ─── 新版并行平台类型 ─────────────────────────────────────

export type McpRoleType = 'controller' | 'developer' | 'tester' | 'analyst' | 'architect' | 'reviewer'
export type RequirementKind = 'analysis' | 'docs' | 'validation' | 'bugfix' | 'refactor' | 'feature'
export type RequirementClarity = 'clear' | 'mixed' | 'ambiguous'
export type RequirementRisk = 'low' | 'medium' | 'high'
export type ControllerDecisionType = 'plan' | 'create-lane' | 'assign-task' | 'reassign-task' | 'lane-status' | 'controller-note'
export type McpNodeStatus = 'idle' | 'assigned' | 'running' | 'blocked' | 'failed' | 'completed'
export type OrchestratedTaskStatus = 'pending' | 'ready' | 'running' | 'blocked' | 'reviewing' | 'completed' | 'failed'
export type SessionPhase = 'planning' | 'preflight' | 'running' | 'reviewing' | 'merging' | 'completed' | 'failed'
export type PreflightStatus = 'passed' | 'warning' | 'failed'
export type ContractValidationStatus = 'pending' | 'valid' | 'invalid'

export interface TokenBudget {
  softLimit: number
  hardLimit: number
}

export interface ModelPolicy {
  preferredModel: string
  fallbackModels: string[]
  allowAutoSwitch: boolean
  preserveProgressOnSwitch: boolean
}

export type McpAction = 'assign' | 'execute' | 'review' | 'approve' | 'merge' | 'override' | 'switch-model'
export type GovernanceStatus = 'pending' | 'review_required' | 'review_assigned' | 'waiting_approval' | 'review_rejected' | 'ready_for_merge' | 'merged'

export interface GovernancePolicy {
  canAssign: boolean
  canExecute: boolean
  canReview: boolean
  canApprove: boolean
  canMerge: boolean
  canOverride: boolean
}

export interface GovernanceState {
  status: GovernanceStatus
  reviewRequiredTaskIds: string[]
  reviewAssignedTaskIds: string[]
  approvedTaskIds: string[]
  rejectedTaskIds: string[]
  readyForMerge: boolean
  mergeApprovedBy?: string
}

export interface ReviewAssignment {
  taskId: string
  reviewerMcpId: string
  authorizedBy: string
  authorizedAt: string
}

export interface GovernanceAuditRecord {
  action: McpAction
  actorMcpId: string
  targetTaskId?: string
  targetMcpId?: string
  allowed: boolean
  reason: string
  timestamp: string
}

export interface McpNode {
  id: string
  roleType: McpRoleType
  name: string
  priority: number
  permissions: string[]
  governancePolicy?: GovernancePolicy
  tokenBudget: TokenBudget
  workspaceId: string
  status: McpNodeStatus
  activeModel: string
  modelPolicy: ModelPolicy
}

export interface OrchestratedTask {
  id: string
  title: string
  description: string
  roleType: McpRoleType
  assignedMcpId?: string
  files: string[]
  dependencies: string[]
  priority: number
  status: OrchestratedTaskStatus
  governanceStatus?: GovernanceStatus
  reviewRequired: boolean
  reviewAssignedTo: string[]
  approvedBy?: string[]
  rejectedBy?: string[]
  tokenBudget?: number
  fallbackPlan: string[]
  artifacts: string[]
  contracts: string[]
  prompt: string
  reassignmentCount?: number
  lastFailureReason?: string
  previousAssignments?: string[]
}

export interface ControllerLaneRecommendation {
  roleType: McpRoleType
  count: number
  reason: string
}

export interface ControllerPlan {
  summary: string
  estimatedParallelism: number
  recommendedExecutionLaneCount: number
  recommendedTotalMcpCount: number
  decompositionStrategy: string
  laneRoleRecommendations: ControllerLaneRecommendation[]
  reasoning: string[]
}

export interface McpLaneState {
  mcpId: string
  roleType: McpRoleType
  status: McpNodeStatus
  createdAt: string
  workspaceId: string
  currentTaskId?: string
  latestReply?: string
  currentElapsedMs?: number
  currentTokens?: number
  cumulativeElapsedMs: number
  cumulativeTokens: number
  completedTaskCount: number
  queueDepth: number
}

export interface ControllerDecision {
  id: string
  timestamp: string
  type: ControllerDecisionType
  summary: string
  reason?: string
  mcpId?: string
  taskId?: string
  fromMcpId?: string
  toMcpId?: string
}

export interface RequirementAnalysis {
  kind: RequirementKind
  likelyLandingZones: string[]
  recommendedRoles: McpRoleType[]
  clarity: RequirementClarity
  clarityHints: string[]
  riskLevel: RequirementRisk
  riskHints: string[]
  estimatedParallelism: number
  recommendedExecutionLaneCount: number
  recommendedTotalMcpCount: number
  laneRoleRecommendations: ControllerLaneRecommendation[]
  decompositionStrategy: string
  controllerSummary: string
  controllerReasoning: string[]
}

export interface TaskReassignmentRecord {
  taskId: string
  fromMcpId: string
  toMcpId: string
  reason: string
  timestamp: string
}

export interface ContractArtifact {
  id: string
  name: string
  producerTaskId: string
  consumerTaskIds: string[]
  version: number
  content: string
  validationStatus: ContractValidationStatus
}

export interface TaskGraph {
  tasks: OrchestratedTask[]
  analysis?: RequirementAnalysis
}

export interface PreflightCheckResult {
  name: string
  status: PreflightStatus
  message: string
  autoFixable: boolean
  fixAction?: string
  category?: 'environment' | 'config' | 'build' | 'git' | 'network'
  currentState?: string
  nextStep?: string
}

export interface ProjectConfigCheck {
  name: string
  status: PreflightStatus
  message: string
  path?: string
  autoFixable: boolean
  fixAction?: string
  nextStep?: string
}

export interface ProjectConfigReport {
  passed: boolean
  checks: ProjectConfigCheck[]
}

export interface ProjectCompletenessArea {
  key: string
  title: string
  status: 'present' | 'partial' | 'missing'
  message: string
}

export interface ProjectCompletenessReport {
  status: 'ready' | 'warning' | 'blocked'
  summary: string
  hardBlockers: string[]
  softGaps: string[]
  suggestions: string[]
  areas: ProjectCompletenessArea[]
}

export interface ProjectDiscovery {
  root: string
  initialized: boolean
  hasGit: boolean
  hasClaudeMd: boolean
  hasMcpConfig: boolean
  hasParallelDir: boolean
  stack: string[]
}

export interface SessionHistoryEntry {
  sessionId: string
  requirement: string
  phase: SessionPhase
  createdAt: string
  updatedAt: string
  controllerMcpId: string
  resumable: boolean
}

export interface StartupTemplate {
  id: string
  title: string
  description: string
  requirement: string
}

export interface RequirementDraft {
  requirement: string
  capturedAt: string
  source: 'tool'
}

export interface StartupFlowStep {
  key: string
  title: string
  status: 'completed' | 'ready' | 'warning' | 'failed'
  message: string
  blocking: boolean
  fixAction?: string
  nextStep?: string
}

export interface StartupFlowState {
  projectRoot: string
  discovery: ProjectDiscovery
  config: ProjectConfigReport
  preflight: PreflightReport
  completeness: ProjectCompletenessReport
  recentSessions: SessionHistoryEntry[]
  templates: StartupTemplate[]
  requirementDraft: RequirementDraft | null
  requirementAnalysis?: RequirementAnalysis
  entries: {
    approve: {
      available: boolean
      reason?: string
    }
    newSession: {
      available: boolean
      reason?: string
    }
    resume: {
      available: boolean
      reason?: string
    }
    template: {
      available: boolean
      reason?: string
    }
  }
  connectionStatus: 'connected'
  developmentStatus: 'ready' | 'blocked' | 'resumable' | 'approval_required'
  canAcceptRequirement: boolean
  requirementPrompt?: string
  recommendedEntry: 'approve' | 'new' | 'resume' | 'template'
  summary: string
  recommendedAction: string
  recommendedReason: string
  nextActions: string[]
  steps: StartupFlowStep[]
}

export interface PreflightReport {
  passed: boolean
  checks: PreflightCheckResult[]
}

export interface AuditRecord {
  id: string
  timestamp: string
  sessionId: string
  scope: 'startup' | 'session' | 'adapter' | 'governance' | 'review' | 'merge' | 'recovery' | 'rollback'
  action: string
  status: 'passed' | 'failed'
  actor?: string
  taskId?: string
  mcpId?: string
  target?: string
  message: string
  metadata?: Record<string, string>
}

export interface TelemetryEvent {
  id: string
  timestamp: string
  sessionId: string
  mcpId?: string
  taskId?: string
  type: string
  message: string
  durationMs?: number
  totalTokens?: number
  activeModel?: string
  metadata?: Record<string, string>
}

export interface ParallelProgressEvent {
  kind: 'session' | 'controller' | 'batch' | 'task' | 'worker' | 'merge' | 'recovery'
  message: string
  phase?: SessionPhase | string
  taskId?: string
  mcpId?: string
  status?: string
  snippet?: string
  batchId?: string
  timestamp: string
  durationMs?: number
  activeModel?: string
  totalTokens?: number
}

export interface ReviewApproval {
  reviewerMcpId: string
  taskId: string
  approved: boolean
  comment?: string
  timestamp: string
}

export interface ReviewArtifact {
  reviewerMcpId: string
  reviewerTaskId: string
  targetTaskId: string
  summary: string
  approved: boolean
  timestamp: string
}

export interface McpMessage {
  id: string
  timestamp: string
  from: string
  to: string
  type: 'assign' | 'ack' | 'progress' | 'result' | 'reassign'
  content: string
  taskId?: string
  durationMs?: number
  tokens?: number
}

export interface RecoveryRecord {
  step: string
  status: 'passed' | 'failed'
  message: string
  timestamp: string
  taskId?: string
  mcpId?: string
  action?: 'retry' | 'reassign' | 'rollback' | 'rollback-single-task' | 'rollback-merge-step' | 'replan' | 'resume' | 'diagnose' | 'manual-attention'
  suggestion?: string
}

export interface ExecutionSession {
  sessionId: string
  projectRoot: string
  requirement: string
  baseBranch: string
  controllerMcpId: string
  phase: SessionPhase
  createdAt: string
  updatedAt: string
  stack: string[]
  mcps: McpNode[]
  taskGraph: TaskGraph
  contracts: ContractArtifact[]
  preflight?: PreflightReport
  contractGate?: PreflightReport
  qualityGate?: PreflightReport
  governance?: GovernanceState
  reviewAssignments?: ReviewAssignment[]
  governanceAudit?: GovernanceAuditRecord[]
  reviewApprovals?: ReviewApproval[]
  reviewArtifacts?: ReviewArtifact[]
  recovery?: RecoveryRecord[]
  auditTrail?: AuditRecord[]
  telemetry: TelemetryEvent[]
  artifacts: Record<string, string>
  controllerPlan?: ControllerPlan
  laneStates?: McpLaneState[]
  controllerDecisions?: ControllerDecision[]
  reassignmentHistory?: TaskReassignmentRecord[]
  messageLog?: McpMessage[]
  resumeCursor: {
    phase: SessionPhase
    taskIds: string[]
  }
}

export interface McpExecutionReportRow {
  mcpId: string
  roleName: string
  workContent: string
  progressStatus: string
  durationMs: number
  totalTokens: number
  activeModel: string
}

export interface TelemetryBreakdown {
  sessionLifecycle: number
  taskLifecycle: number
  workerLifecycle: number
  reviewLifecycle: number
  mergeLifecycle: number
  recoveryLifecycle: number
  other: number
}

export interface TaskMonitoringRow {
  taskId: string
  title: string
  assignedMcpId?: string
  roleType: McpRoleType
  status: OrchestratedTaskStatus
  governanceStatus?: GovernanceStatus
  durationMs: number
  totalTokens: number
}

export interface MonitoringSummary {
  totalDurationMs: number
  totalTokens: number
  telemetryCount: number
  warningCount: number
  failureCount: number
  activeModelUsage: Array<{
    model: string
    count: number
  }>
  eventBreakdown: TelemetryBreakdown
  taskRows: TaskMonitoringRow[]
}

export interface ExecutionSummaryReport {
  sessionId: string
  requirement?: string
  totalDurationMs: number
  totalTokens: number
  completedCount: number
  failedCount: number
  blockedCount: number
  governanceStatus?: GovernanceStatus
  telemetryCount?: number
  warningCount?: number
  failureCount?: number
  monitoring?: MonitoringSummary
  startup?: {
    configPassed: boolean
    completeness: ProjectCompletenessReport
    planning?: RequirementAnalysis
  }
  merge: {
    success: boolean
    order: string[]
    merged: string[]
    failed: Array<{
      branch: string
      error?: string
    }>
    conflicts: string[]
    error?: string
  }
  rows: McpExecutionReportRow[]
}

export interface WorkspaceDescriptor {
  id: string
  mcpId: string
  branch: string
  path: string
}

export const PARALLEL_DIR = '.claude/parallel'
export const PARALLEL_SESSION_FILE = '.claude/parallel/session.json'
export const PARALLEL_REPORT_FILE = '.claude/parallel/report.json'
export const PARALLEL_CONTRACTS_FILE = '.claude/parallel/contracts.json'
export const PARALLEL_TELEMETRY_FILE = '.claude/parallel/telemetry.json'
export const PARALLEL_AUDIT_FILE = '.claude/parallel/audit.json'
export const PARALLEL_REQUIREMENT_FILE = '.claude/parallel/requirement.json'
export const PARALLEL_WORKSPACES_DIR = '.claude/parallel/workspaces'
export const PARALLEL_CONTEXT_DIR = '.claude/parallel/context'

export interface TaskContextSnapshot {
  mcpId: string
  taskId: string
  sessionId: string
  roleType: string
  title: string
  requirement: string
  patchRequirement?: string
  status: string
  output: string
  files: string[]
  durationMs: number
  tokens: number
  timestamp: string
  createdAt: string
}

export interface ContextIndex {
  mcpId: string
  taskId: string
  file: string
  title: string
  status: string
  createdAt: string
  tokens: number
}
