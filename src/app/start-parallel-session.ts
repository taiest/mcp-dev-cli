import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ContractArtifact,
  ExecutionSession,
  GovernancePolicy,
  ModelPolicy,
  McpNode,
} from '../types.js'
import { AGENTS_DIR } from '../types.js'
import { PreflightScanner } from '../core/preflight/preflight-scanner.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { TaskGraphBuilder } from '../core/scheduler/task-graph.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { StackPolicyEngine } from '../core/policy/stack-policy-engine.js'
import { PolicyEngine } from '../core/policy/policy-engine.js'
import { ContractValidator } from '../core/contracts/contract-validator.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { buildDashboardView } from '../core/report/dashboard-view.js'
import { renderExecutionPlan, renderSessionOutcome } from '../core/terminal/renderers.js'

function defaultPolicy(): ModelPolicy {
  return {
    preferredModel: 'sonnet',
    fallbackModels: ['opus', 'haiku'],
    allowAutoSwitch: true,
    preserveProgressOnSwitch: true,
  }
}

function governancePolicy(roleType: McpNode['roleType'], index: number): GovernancePolicy {
  if (index === 0 || roleType === 'controller') {
    return {
      canAssign: true,
      canExecute: true,
      canReview: true,
      canApprove: true,
      canMerge: true,
      canOverride: true,
    }
  }

  if (roleType === 'reviewer') {
    return {
      canAssign: false,
      canExecute: true,
      canReview: true,
      canApprove: true,
      canMerge: false,
      canOverride: false,
    }
  }

  return {
    canAssign: false,
    canExecute: true,
    canReview: false,
    canApprove: false,
    canMerge: false,
    canOverride: false,
  }
}

function buildDefaultMcps(count: number): McpNode[] {
  const roles = ['controller', 'analyst', 'architect', 'developer', 'tester', 'reviewer'] as const
  return Array.from({ length: count }).map((_, index) => ({
    id: `MCP-${String(index + 1).padStart(2, '0')}`,
    roleType: roles[index] || 'developer',
    name: roles[index] || `developer-${index + 1}`,
    priority: index + 1,
    permissions: index === 0
      ? ['assign', 'execute', 'review', 'approve', 'switch-model', 'merge', 'override']
      : roles[index] === 'reviewer'
        ? ['execute', 'review', 'approve']
        : ['execute'],
    governancePolicy: governancePolicy(roles[index] || 'developer', index),
    tokenBudget: { softLimit: 20000, hardLimit: 40000 },
    workspaceId: `ws-${index + 1}`,
    status: 'idle',
    activeModel: 'sonnet',
    modelPolicy: defaultPolicy(),
  }))
}

function buildBootstrapContracts(tasks: Array<{ id: string; roleType: string }>): ContractArtifact[] {
  return tasks
    .filter(task => task.roleType === 'architect' || task.roleType === 'developer')
    .map((task, index) => {
      const consumerTaskIds = tasks.filter(other => other.id !== task.id).map(other => other.id)
      if (consumerTaskIds.length === 0) return null
      return {
        id: `contract:${task.id}`,
        name: `${task.roleType}-contract-${index + 1}`,
        producerTaskId: task.id,
        consumerTaskIds,
        version: 1,
        content: JSON.stringify({
          ownerTaskId: task.id,
          version: 1,
          summary: `Contract owned by ${task.id} for ${task.roleType}`,
          kind: task.roleType === 'architect' ? 'api' : 'delivery',
        }),
        validationStatus: 'valid',
      }
    })
    .filter((contract): contract is ContractArtifact => Boolean(contract))
}

function attachContractsToTasks(session: ExecutionSession): ExecutionSession {
  const reviewTargets = session.taskGraph.tasks
    .filter(task => task.reviewRequired)
    .map(task => `${task.id}: ${task.title}`)

  return {
    ...session,
    taskGraph: {
      tasks: session.taskGraph.tasks.map(task => {
        const relatedContracts = session.contracts
          .filter(contract => contract.producerTaskId === task.id || contract.consumerTaskIds.includes(task.id))
          .map(contract => contract.id)

        const reviewerDescription = task.roleType === 'reviewer'
          ? `${task.description}\n\nreview targets:\n${reviewTargets.join('\n') || 'none'}`
          : task.description

        return {
          ...task,
          description: reviewerDescription,
          governanceStatus: task.reviewRequired ? 'review_required' : 'pending',
          contracts: Array.from(new Set([...task.contracts, ...relatedContracts])),
        }
      }),
    },
  }
}

function agentFileName(mcp: McpNode): string {
  return `${mcp.name}.md`
}

export function createAgentFiles(projectRoot: string, session: ExecutionSession): Array<{ mcpId: string; file: string; role: string; tasks: string[] }> {
  const agentsRoot = join(projectRoot, AGENTS_DIR)
  mkdirSync(agentsRoot, { recursive: true })

  return session.mcps.map(mcp => {
    const tasks = session.taskGraph.tasks
      .filter(task => task.assignedMcpId === mcp.id)
      .map(task => `${task.id} ${task.title}`)
    const file = agentFileName(mcp)
    const content = [
      `# ${mcp.name}`,
      '',
      `- MCP: ${mcp.id}`,
      `- Role: ${mcp.roleType}`,
      `- Model: ${mcp.activeModel}`,
      `- Workspace: ${mcp.workspaceId}`,
      `- Session: ${session.sessionId}`,
      '',
      '## Assigned Tasks',
      '',
      ...(tasks.length > 0 ? tasks.map(item => `- ${item}`) : ['- waiting for assignment']),
    ].join('\n')
    writeFileSync(join(agentsRoot, file), content, 'utf-8')
    return { mcpId: mcp.id, file, role: mcp.roleType, tasks }
  })
}

export function summarizeAssignments(session: ExecutionSession): string[] {
  return session.mcps.map(mcp => {
    const tasks = session.taskGraph.tasks.filter(task => task.assignedMcpId === mcp.id)
    return `${mcp.id} [${mcp.roleType}] ${tasks.map(task => `${task.id}:${task.title}`).join(', ') || 'waiting'}`
  })
}

export function summarizeCreatedRoles(roles: Array<{ mcpId: string; file: string; role: string; tasks: string[] }>): string[] {
  return roles.map(role => `${role.mcpId} -> .claude/agents/${role.file} [${role.role}] ${role.tasks.length > 0 ? `${role.tasks.length} tasks` : 'waiting'}`)
}

export async function startParallelSession(requirementInput: string | undefined, projectRoot: string, mcpCount = 6): Promise<string> {
  const runtime = new SessionRuntime(projectRoot)
  const draft = runtime.loadRequirementDraft()
  const requirement = (requirementInput || draft?.requirement || '').trim()

  if (!requirement) {
    const startup = await runtime.buildStartupFlow()
    return renderSessionOutcome({
      action: 'blocked',
      sessionId: 'requirement-missing',
      phase: 'planning',
      summary: [['startup', startup.developmentStatus], ['recommended', startup.recommendedAction]],
      sections: [{
        title: 'Requirement Input',
        lines: [
          'No requirement draft found.',
          'Use parallel_requirement to capture the project requirement first, or pass requirement directly to parallel_start.',
        ],
      }],
      nextStep: 'Run parallel_requirement, then rerun parallel_start.',
    })
  }

  runtime.saveRequirementDraft(requirement)
  const preflight = await new PreflightScanner().scan(projectRoot)
  const scheduler = new Scheduler()
  const policy = new PolicyEngine()
  const mcps = buildDefaultMcps(mcpCount)
  const taskGraph = new TaskGraphBuilder().build(requirement, projectRoot)
  const contracts = buildBootstrapContracts(taskGraph.tasks)
  const session = runtime.create(requirement, mcps, taskGraph, preflight)
  const stackGate = new StackPolicyEngine().validateRequirement(projectRoot, session.stack, requirement, taskGraph)
  const prepared = attachContractsToTasks({
    ...session,
    contracts,
  })
  const scheduled = scheduler.schedule(prepared)
  const policyGate = policy.validateSession(scheduled)
  const contractGate = new ContractValidator().validateAll(contracts)

  if (!preflight.passed || stackGate.status === 'failed' || !contractGate.passed || !policyGate.passed) {
    const blockedSession = runtime.appendAudit({
      ...scheduled,
      phase: 'failed',
      contracts,
      contractGate,
      governanceAudit: policy.buildGovernanceAudit(scheduled, scheduled.reviewAssignments || []),
      artifacts: {
        ...scheduled.artifacts,
        stackPolicy: JSON.stringify(stackGate, null, 2),
        policyGate: JSON.stringify(policyGate, null, 2),
      },
    }, [
      createAuditRecord({
        sessionId: session.sessionId,
        scope: 'startup',
        action: 'preflight-block',
        status: 'failed',
        actor: session.controllerMcpId,
        message: 'session blocked before execution',
        metadata: {
          preflight: String(preflight.passed),
          stackGate: stackGate.status,
          policyGate: String(policyGate.passed),
          contractGate: String(contractGate.passed),
        },
      }),
    ])
    runtime.save(blockedSession)
    return renderSessionOutcome({
      action: 'blocked',
      sessionId: scheduled.sessionId,
      phase: 'failed',
      summary: [
        ['preflight', preflight.passed ? 'passed' : 'failed'],
        ['stack policy', stackGate.status],
        ['policy gate', policyGate.passed ? 'passed' : 'failed'],
        ['contract gate', contractGate.passed ? 'passed' : 'failed'],
      ],
      sections: [
        {
          title: 'Checks',
          lines: [
            ...preflight.checks.map(check => `${check.name}: ${check.status} ${check.message}`),
            `${stackGate.name}: ${stackGate.status} ${stackGate.message}`,
            ...policyGate.checks.map(check => `${check.name}: ${check.status} ${check.message}`),
            ...contractGate.checks.map(check => `${check.name}: ${check.status} ${check.message}`),
          ],
        },
      ],
      nextStep: 'Run parallel_preflight, fix failed checks or hard blockers, then rerun parallel_start.',
    })
  }

  const planned: ExecutionSession = {
    ...scheduled,
    phase: 'planning',
    contracts,
    contractGate,
    governanceAudit: policy.buildGovernanceAudit(scheduled, scheduled.reviewAssignments || []),
    artifacts: {
      ...scheduled.artifacts,
      stackPolicy: JSON.stringify(stackGate, null, 2),
      policyGate: JSON.stringify(policyGate, null, 2),
      assignmentSummary: JSON.stringify(summarizeAssignments(scheduled), null, 2),
    },
    resumeCursor: {
      phase: 'planning',
      taskIds: scheduled.taskGraph.tasks.map(task => task.id),
    },
  }
  runtime.save(planned)
  runtime.clearRequirementDraft()

  return renderExecutionPlan(buildDashboardView(planned))
}
