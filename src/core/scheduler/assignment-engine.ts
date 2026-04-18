import type { McpNode, McpRoleType, OrchestratedTask } from '../../types.js'

function compareByPriority(left: McpNode, right: McpNode): number {
  return left.priority - right.priority || left.id.localeCompare(right.id)
}

export class AssignmentEngine {
  assign(tasks: OrchestratedTask[], mcps: McpNode[]): OrchestratedTask[] {
    const load = new Map(mcps.map(mcp => [mcp.id, 0]))

    const pickLeastLoaded = (candidates: McpNode[]): McpNode | undefined => {
      return [...candidates].sort((left, right) => {
        const loadDiff = (load.get(left.id) || 0) - (load.get(right.id) || 0)
        return loadDiff || compareByPriority(left, right)
      })[0]
    }

    const withAssignment = tasks.map(task => {
      const exactRole = mcps.filter(mcp => mcp.roleType === task.roleType)
      const developerPool = mcps.filter(mcp => mcp.roleType === 'developer')
      const fallbackRoles: McpRoleType[] = task.roleType === 'reviewer'
        ? ['reviewer', 'controller', 'architect', 'developer']
        : task.roleType === 'tester'
          ? ['tester', 'developer']
          : task.roleType === 'architect'
            ? ['architect', 'analyst', 'developer']
            : task.roleType === 'analyst'
              ? ['analyst', 'architect', 'developer']
              : ['developer', 'architect', 'analyst']
      const fallbackPool = mcps.filter(mcp => fallbackRoles.includes(mcp.roleType))
      const nonControllerPool = mcps.filter(mcp => mcp.roleType !== 'controller')
      const assigned = pickLeastLoaded(exactRole)
        || pickLeastLoaded(fallbackPool)
        || pickLeastLoaded(developerPool)
        || pickLeastLoaded(nonControllerPool)
        || pickLeastLoaded(mcps)

      if (assigned) {
        load.set(assigned.id, (load.get(assigned.id) || 0) + 1)
      }

      return {
        ...task,
        assignedMcpId: assigned?.id,
        reviewAssignedTo: task.reviewRequired ? mcps.filter(mcp => mcp.roleType === 'reviewer').map(mcp => mcp.id) : [],
      }
    })

    return withAssignment
  }
}
