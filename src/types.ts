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
}

export const DEFAULT_CONFIG: Config = {
  model: 'sonnet',
  maxConcurrency: 3,
  projectRoot: process.cwd(),
  autoConfirm: false,
}

// ─── 常量 ───────────────────────────────────────────────

export const AGENTS_DIR = '.claude/agents'
export const CONTEXT_DIR = '.claude/context'
export const CONTRACT_DIR = '.claude/context/api-contract'
export const CHECKPOINT_FILE = '.claude/context/task-checkpoint.json'
export const BRANCH_PREFIX = 'mcp/'
