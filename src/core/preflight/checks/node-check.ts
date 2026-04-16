import type { PreflightCheckResult } from '../../../types.js'

export function runNodeCheck(): PreflightCheckResult {
  const major = Number(process.versions.node.split('.')[0] || '0')
  return {
    name: 'node',
    status: major >= 18 ? 'passed' : 'failed',
    message: major >= 18 ? `Node ${process.versions.node}` : `Node ${process.versions.node} 低于要求`,
    autoFixable: false,
    category: 'environment',
    currentState: major >= 18 ? 'ready' : 'version-too-low',
    nextStep: major >= 18 ? undefined : '升级到 Node 18 或更高版本后再启动 parallel session。',
  }
}
