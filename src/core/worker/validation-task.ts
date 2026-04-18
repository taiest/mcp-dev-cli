import type { OrchestratedTask } from '../../types.js'

const validationKeywords = [
  'smoke test',
  'validate',
  'validation',
  'verify',
  'verification',
  '只验证',
  '仅验证',
  '不要修改仓库代码',
  '避免修改仓库代码',
  'avoid modifying repository code',
  'do not modify repository code',
  'without modifying repository code',
  'read-only',
  'readonly',
]

function includesValidationKeyword(text: string): boolean {
  const normalized = text.toLowerCase()
  return validationKeywords.some(keyword => normalized.includes(keyword))
}

export function isReadOnlyValidationText(text: string): boolean {
  return includesValidationKeyword(text)
}

export function isReadOnlyValidationTask(task: Pick<OrchestratedTask, 'title' | 'description' | 'prompt'>): boolean {
  return includesValidationKeyword(`${task.title}\n${task.description}\n${task.prompt}`)
}
