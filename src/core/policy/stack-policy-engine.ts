import type { PreflightCheckResult, TaskGraph } from '../../types.js'
import { detectTechStack } from '../../utils/platform.js'

interface StackSignal {
  keyword: string
  capability: 'go' | 'node' | 'python' | 'rust' | 'java'
  label: string
}

const STACK_SIGNALS: StackSignal[] = [
  { keyword: 'go', capability: 'go', label: 'go' },
  { keyword: 'golang', capability: 'go', label: 'go' },
  { keyword: 'gin', capability: 'go', label: 'go' },
  { keyword: 'node', capability: 'node', label: 'node.js' },
  { keyword: 'typescript', capability: 'node', label: 'typescript/node.js' },
  { keyword: 'javascript', capability: 'node', label: 'javascript/node.js' },
  { keyword: 'npm', capability: 'node', label: 'node.js' },
  { keyword: 'pnpm', capability: 'node', label: 'node.js' },
  { keyword: 'react', capability: 'node', label: 'react/node.js' },
  { keyword: 'vue', capability: 'node', label: 'vue/node.js' },
  { keyword: 'next.js', capability: 'node', label: 'next.js/node.js' },
  { keyword: 'nextjs', capability: 'node', label: 'next.js/node.js' },
  { keyword: 'python', capability: 'python', label: 'python' },
  { keyword: 'django', capability: 'python', label: 'python' },
  { keyword: 'fastapi', capability: 'python', label: 'python' },
  { keyword: 'rust', capability: 'rust', label: 'rust' },
  { keyword: 'cargo', capability: 'rust', label: 'rust' },
  { keyword: 'java', capability: 'java', label: 'java' },
  { keyword: 'spring', capability: 'java', label: 'java' },
]

export class StackPolicyEngine {
  validate(projectStack: string[], requestedStack: string[]): PreflightCheckResult {
    const normalizedProject = projectStack.map(item => item.trim().toLowerCase()).filter(Boolean)
    const normalizedRequested = requestedStack.map(item => item.trim().toLowerCase()).filter(Boolean)
    const incompatible = normalizedRequested.filter(item => !normalizedProject.includes(item))

    return {
      name: 'stack-policy',
      status: incompatible.length === 0 ? 'passed' : 'failed',
      message: incompatible.length === 0
        ? `技术栈保持一致: ${projectStack.join(', ') || 'unknown'}`
        : `检测到潜在偏栈请求: ${incompatible.join(', ')}`,
      autoFixable: false,
      ...(incompatible.length > 0 ? { fixAction: `仅允许使用现有技术栈: ${projectStack.join(', ') || 'unknown'}` } : {}),
    }
  }

  validateRequirement(projectRoot: string, projectStack: string[], requirement: string, taskGraph?: TaskGraph): PreflightCheckResult {
    const detected = detectTechStack(projectRoot)
    const allowedCapabilities = new Set<string>()
    if (detected.hasGo) allowedCapabilities.add('go')
    if (detected.hasNode) allowedCapabilities.add('node')
    if (detected.hasPython) allowedCapabilities.add('python')
    if (detected.hasRust) allowedCapabilities.add('rust')

    const normalizedRequirement = requirement.toLowerCase()
    const explicitSignals = STACK_SIGNALS.filter(item => normalizedRequirement.includes(item.keyword))
    const unsupported = Array.from(new Set(
      explicitSignals
        .filter(item => !allowedCapabilities.has(item.capability))
        .map(item => item.label)
    ))

    const workKinds = new Set(taskGraph?.tasks.map(task => task.roleType) || [])
    const mode = workKinds.has('developer') || workKinds.has('tester') || workKinds.has('architect')
      ? 'implementation'
      : 'analysis'

    if (unsupported.length > 0) {
      return {
        name: 'stack-policy',
        status: 'failed',
        message: `检测到超出仓库能力的技术栈请求: ${unsupported.join(', ')}`,
        autoFixable: false,
        fixAction: `仅允许使用仓库现有能力: ${projectStack.join(', ') || 'unknown'}`,
      }
    }

    const capabilitySummary = [
      detected.hasGo ? 'go' : '',
      detected.hasNode ? 'node.js' : '',
      detected.hasPython ? 'python' : '',
      detected.hasRust ? 'rust' : '',
    ].filter(Boolean)

    return {
      name: 'stack-policy',
      status: 'passed',
      message: `${mode} scope stays within repo capabilities: ${capabilitySummary.join(', ') || projectStack.join(', ') || 'unknown'}`,
      autoFixable: false,
    }
  }
}
