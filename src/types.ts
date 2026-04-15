// ─── 任务状态 ───────────────────────────────────────────

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

// ─── 上下文 / 缓存 ───────────────────────────────────────

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

// ─── 任务拆分 ───────────────────────────────────────────

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

// ─── 角色 ───────────────────────────────────────────────

export interface AgentConfig {
  name: string
  description: string
  tools: string
  model: string
  color: string
  content: string
}

// ─── Worker ─────────────────────────────────────────────

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
}

// ─── 配置 ───────────────────────────────────────────────

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

// ─── 常量 ───────────────────────────────────────────────

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
