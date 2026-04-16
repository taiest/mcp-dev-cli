import type { McpNode, OrchestratedTask } from '../../types.js'

export class AssignmentEngine {
  assign(tasks: OrchestratedTask[], mcps: McpNode[]): OrchestratedTask[] {
    return tasks.map(task => {
      const assigned = mcps.find(mcp => mcp.roleType === task.roleType) || mcps.find(mcp => mcp.roleType === 'developer') || mcps[0]
      return {
        ...task,
        assignedMcpId: assigned?.id,
        reviewAssignedTo: task.reviewRequired ? mcps.filter(mcp => mcp.roleType === 'reviewer').map(mcp => mcp.id) : [],
      }
    })
  }
}
