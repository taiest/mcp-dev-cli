import type {
  ContractArtifact,
  ExecutionSession,
  GovernancePolicy,
  McpNode,
  MergeResult,
  ModelPolicy,
} from '../types.js'
import { PreflightScanner } from '../core/preflight/preflight-scanner.js'
import { SessionRuntime } from '../core/runtime/session-runtime.js'
import { TaskGraphBuilder } from '../core/scheduler/task-graph.js'
import { Scheduler } from '../core/scheduler/scheduler.js'
import { WorkspaceManager } from '../core/workspace/workspace-manager.js'
import { buildContextSummary } from '../core/context/context-summary.js'
import { StackPolicyEngine } from '../core/policy/stack-policy-engine.js'
import { PolicyEngine } from '../core/policy/policy-engine.js'
import { ContractValidator } from '../core/contracts/contract-validator.js'
import { createAuditRecord } from '../core/telemetry/audit-trail.js'
import { buildMergeSummaryLines, executeSessionPipeline } from '../core/orchestrator.js'

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
    .map((task, index) => ({
      id: `contract:${task.id}`,
      name: `${task.roleType}-contract-${index + 1}`,
      producerTaskId: task.id,
      consumerTaskIds: tasks.filter(other => other.id !== task.id).map(other => other.id),
      version: 1,
      content: JSON.stringify({
        ownerTaskId: task.id,
        version: 1,
        summary: `Contract owned by ${task.id} for ${task.roleType}`,
        kind: task.roleType === 'architect' ? 'api' : 'delivery',
      }),
      validationStatus: 'valid',
    }))
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

export async function startParallelSession(requirement: string, projectRoot: string, mcpCount = 6): Promise<string> {
  const preflight = await new PreflightScanner().scan(projectRoot)
  const runtime = new SessionRuntime(projectRoot)
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
    return [
      `❌ session blocked: ${scheduled.sessionId}`,
      ...preflight.checks.map(check => `- ${check.name}: ${check.status} ${check.message}`),
      `- ${stackGate.name}: ${stackGate.status} ${stackGate.message}`,
      ...policyGate.checks.map(check => `- ${check.name}: ${check.status} ${check.message}`),
      ...contractGate.checks.map(check => `- ${check.name}: ${check.status} ${check.message}`),
    ].join('\n')
  }

  const workspaceManager = new WorkspaceManager(projectRoot)
  const workspaces = await workspaceManager.prepare(scheduled)
  const running = runtime.appendAudit({
    ...scheduled,
    phase: 'running',
    contracts,
    contractGate,
    governanceAudit: policy.buildGovernanceAudit(scheduled, scheduled.reviewAssignments || []),
    artifacts: {
      ...scheduled.artifacts,
      workspaceMap: JSON.stringify(workspaces, null, 2),
      stackPolicy: JSON.stringify(stackGate, null, 2),
      policyGate: JSON.stringify(policyGate, null, 2),
    },
  }, [
    createAuditRecord({
      sessionId: session.sessionId,
      scope: 'session',
      action: 'launch-workspaces',
      status: 'passed',
      actor: session.controllerMcpId,
      message: 'parallel workspaces prepared',
      metadata: {
        workspaceCount: String(Object.keys(workspaces).length),
      },
    }),
  ])
  runtime.save(running)

  const context = buildContextSummary({
    goal: requirement,
    constraints: [`技术栈必须保持: ${running.stack.join(', ') || 'unknown'}`],
    analysis: 'parallel execution in progress',
    plan: running.taskGraph.tasks.map(task => `${task.id}:${task.title}`).join('\n'),
    risks: stackGate.status === 'passed' ? [] : [stackGate.message],
    nextSteps: [],
    phase: running.phase,
  })

  const finalSession = await executeSessionPipeline({
    projectRoot,
    session: running,
    workspaces,
    contracts,
    context,
    taskAction: 'task-execution',
    mergeAction: 'merge-session',
    mergeSuccessMessage: 'merge completed',
    mergeFailureFallback: 'merge failed',
    includeGovernanceAuditRecord: true,
    includeMergeMetadata: true,
  })

  const mergeResult = finalSession.artifacts.mergeResult
    ? JSON.parse(finalSession.artifacts.mergeResult) as MergeResult
    : null
  const failed = finalSession.taskGraph.tasks.filter(task => task.status === 'failed').length
  const completed = finalSession.taskGraph.tasks.filter(task => task.status === 'completed').length
  const reviewArtifacts = finalSession.reviewArtifacts || []
  const recovery = finalSession.recovery || []

  return [
    `✅ started parallel session: ${finalSession.sessionId}`,
    `phase: ${finalSession.phase}`,
    `controller: ${finalSession.controllerMcpId}`,
    `governance: ${finalSession.governance?.status || 'pending'}`,
    `preflight: passed`,
    `stack-policy: ${stackGate.status}`,
    `policy-gate: ${policyGate.passed ? 'passed' : 'failed'}`,
    `contracts: ${contractGate.passed ? 'passed' : 'failed'}`,
    `review-artifacts: ${reviewArtifacts.length}`,
    `review-assignments: ${finalSession.reviewAssignments?.length || 0}`,
    `quality-gate: ${finalSession.qualityGate?.passed ? 'passed' : 'failed'}`,
    ...buildMergeSummaryLines(mergeResult),
    `recovery: ${recovery.length}`,
    `audit trail: ${finalSession.auditTrail?.length || 0}`,
    `completed tasks: ${completed}`,
    `failed tasks: ${failed}`,
    `workspaces: ${Object.values(workspaces).map(item => `${item.mcpId}@${item.path}`).join(', ')}`,
  ].join('\n')
}
