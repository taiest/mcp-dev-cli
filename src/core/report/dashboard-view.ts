import type { ExecutionSession } from '../../types.js'
import { MetricsAggregator } from '../telemetry/metrics-aggregator.js'

function blockedReasons(artifacts: string[]): string[] {
  return artifacts.filter(item => item.startsWith('blocked-by-contract:'))
}

export function buildDashboardView(session: ExecutionSession): Record<string, unknown> {
  const taskCounts = {
    pending: session.taskGraph.tasks.filter(task => task.status === 'pending').length,
    ready: session.taskGraph.tasks.filter(task => task.status === 'ready').length,
    running: session.taskGraph.tasks.filter(task => task.status === 'running').length,
    blocked: session.taskGraph.tasks.filter(task => task.status === 'blocked').length,
    reviewing: session.taskGraph.tasks.filter(task => task.status === 'reviewing').length,
    completed: session.taskGraph.tasks.filter(task => task.status === 'completed').length,
    failed: session.taskGraph.tasks.filter(task => task.status === 'failed').length,
  }
  const mergeResult = session.artifacts.mergeResult ? JSON.parse(session.artifacts.mergeResult) as {
    success?: boolean
    mergeOrder?: string[]
    mergedBranches?: string[]
    failedBranches?: Array<{ branch: string; error?: string }>
    conflicts?: string[]
    error?: string
  } : undefined
  const metrics = new MetricsAggregator().build(session)

  return {
    sessionId: session.sessionId,
    phase: session.phase,
    controller: session.controllerMcpId,
    stack: session.stack,
    monitoring: metrics.monitoring,
    startup: {
      requirement: session.requirement,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      resumable: session.phase !== 'completed',
      entryHints: ['parallel_startup', 'parallel_preflight', 'parallel_start', 'parallel_resume'],
    },
    governance: session.governance || {
      status: 'pending',
      reviewRequiredTaskIds: [],
      reviewAssignedTaskIds: [],
      approvedTaskIds: [],
      rejectedTaskIds: [],
      readyForMerge: false,
    },
    governanceAudit: session.governanceAudit || [],
    auditTrail: session.auditTrail || [],
    reviewAssignments: session.reviewAssignments || [],
    preflight: session.preflight,
    contractGate: session.contractGate,
    qualityGate: session.qualityGate,
    reviewArtifacts: session.reviewArtifacts || [],
    reviewApprovals: session.reviewApprovals || [],
    recovery: session.recovery || [],
    recoverySuggestions: (session.recovery || []).map(item => ({
      step: item.step,
      action: item.action,
      taskId: item.taskId,
      mcpId: item.mcpId,
      suggestion: item.suggestion,
    })),
    merge: {
      success: Boolean(mergeResult?.success),
      order: mergeResult?.mergeOrder || [],
      merged: mergeResult?.mergedBranches || [],
      failed: mergeResult?.failedBranches || [],
      conflicts: mergeResult?.conflicts || [],
      error: mergeResult?.error,
    },
    resumeCursor: session.resumeCursor,
    telemetryCount: session.telemetry.length,
    taskCounts,
    blockedTasks: session.taskGraph.tasks
      .filter(task => task.status === 'blocked')
      .map(task => ({ id: task.id, title: task.title, reasons: blockedReasons(task.artifacts) })),
    mcps: session.mcps.map(mcp => ({
      id: mcp.id,
      roleType: mcp.roleType,
      status: mcp.status,
      activeModel: mcp.activeModel,
      permissions: mcp.permissions,
      governancePolicy: mcp.governancePolicy,
      assignedTasks: session.taskGraph.tasks
        .filter(task => task.assignedMcpId === mcp.id)
        .map(task => ({
          id: task.id,
          title: task.title,
          status: task.status,
          governanceStatus: task.governanceStatus,
          reviewAssignedTo: task.reviewAssignedTo,
          approvedBy: task.approvedBy || [],
          rejectedBy: task.rejectedBy || [],
          blockedReasons: blockedReasons(task.artifacts),
        })),
    })),
    contracts: session.contracts.map(contract => ({
      id: contract.id,
      name: contract.name,
      version: contract.version,
      validationStatus: contract.validationStatus,
      producerTaskId: contract.producerTaskId,
    })),
    recentTelemetry: session.telemetry.slice(-10),
  }
}
