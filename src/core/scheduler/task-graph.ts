import type { McpRoleType, OrchestratedTask, TaskGraph } from '../../types.js'
import { detectTechStack } from '../../utils/platform.js'
import { isReadOnlyValidationText } from '../worker/validation-task.js'

type RequirementKind = 'analysis' | 'docs' | 'validation' | 'bugfix' | 'refactor' | 'feature'

interface TaskSeed {
  roleType: McpRoleType
  title: string
  description: string
  dependencies: string[]
  reviewRequired: boolean
  files: string[]
  contracts?: string[]
}

export class TaskGraphBuilder {
  build(
    requirement: string,
    projectRoot: string,
    preferredRoles: McpRoleType[] = ['analyst', 'architect', 'developer', 'tester', 'reviewer']
  ): TaskGraph {
    const normalized = requirement.toLowerCase()
    const stack = detectTechStack(projectRoot)
    const kind = this.classifyRequirement(normalized)
    const seeds = this.buildSeeds(kind, requirement, stack.frameworks, preferredRoles)
    const tasks: OrchestratedTask[] = seeds.map((seed, index) => ({
      id: `task-${index + 1}`,
      title: seed.title,
      description: seed.description,
      roleType: seed.roleType,
      assignedMcpId: undefined,
      files: seed.files,
      dependencies: seed.dependencies,
      priority: index + 1,
      status: seed.dependencies.length === 0 ? 'ready' : 'pending',
      reviewRequired: seed.reviewRequired,
      reviewAssignedTo: [],
      tokenBudget: 0,
      fallbackPlan: ['reschedule', 'reassign', 'switch-model'],
      artifacts: [],
      contracts: seed.contracts || [],
      prompt: `${seed.description}\n\nRequirement: ${requirement}`,
    }))
    return { tasks }
  }

  private classifyRequirement(requirement: string): RequirementKind {
    if (this.matches(requirement, ['explain', 'investigate', 'analyze', 'analysis', 'plan', '设计', '分析', '调研'])) {
      return 'analysis'
    }
    if (this.matches(requirement, ['readme', 'docs', 'documentation', 'changelog', '文档'])) {
      return 'docs'
    }
    if (isReadOnlyValidationText(requirement)) {
      return 'validation'
    }
    if (this.matches(requirement, ['fix', 'bug', 'issue', 'error', 'regression', '修复', '问题', '报错'])) {
      return 'bugfix'
    }
    if (this.matches(requirement, ['refactor', 'cleanup', 'restructure', 'optimize', '重构', '优化'])) {
      return 'refactor'
    }
    return 'feature'
  }

  private buildSeeds(
    kind: RequirementKind,
    requirement: string,
    frameworks: string[],
    preferredRoles: McpRoleType[]
  ): TaskSeed[] {
    const stackText = frameworks.join(', ') || 'current stack'
    const includeRole = (role: McpRoleType): boolean => preferredRoles.includes(role)

    switch (kind) {
      case 'analysis': {
        const seeds: TaskSeed[] = []
        if (includeRole('analyst')) {
          seeds.push({
            roleType: 'analyst',
            title: 'Analyze requirement scope',
            description: `Analyze the request, impacted areas, and constraints for: ${requirement}. Focus on ${stackText}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          })
        }
        if (this.matches(requirement.toLowerCase(), ['design', 'architecture', 'plan', '方案', '架构']) && includeRole('architect')) {
          seeds.push({
            roleType: 'architect',
            title: 'Design implementation approach',
            description: `Produce an architecture or implementation approach for: ${requirement}. Keep within ${stackText}.`,
            dependencies: seeds.length > 0 ? ['task-1'] : [],
            reviewRequired: false,
            files: [],
          })
        }
        return seeds.length > 0 ? seeds : [{
          roleType: 'analyst',
          title: 'Analyze request',
          description: `Analyze the request and summarize next actions for: ${requirement}.`,
          dependencies: [],
          reviewRequired: false,
          files: [],
        }]
      }
      case 'docs':
        return [
          {
            roleType: includeRole('developer') ? 'developer' : preferredRoles[0] || 'developer',
            title: 'Update documentation',
            description: `Update the relevant documentation for: ${requirement}. Keep examples and wording aligned with ${stackText}.`,
            dependencies: [],
            reviewRequired: false,
            files: ['README.md', 'docs/**'],
          },
        ]
      case 'validation':
        return [
          {
            roleType: includeRole('tester') ? 'tester' : preferredRoles[0] || 'tester',
            title: 'Run smoke/read-only validation',
            description: `Run read-only validation for: ${requirement}. Do not modify repository code. Verify current behavior within ${stackText}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          },
        ]
      case 'bugfix': {
        const seeds: TaskSeed[] = [
          {
            roleType: includeRole('developer') ? 'developer' : preferredRoles[0] || 'developer',
            title: 'Fix implementation issue',
            description: `Fix the root cause for: ${requirement}. Keep changes within ${stackText}.`,
            dependencies: [],
            reviewRequired: true,
            files: [],
          },
        ]

        if (includeRole('tester')) {
          seeds.push({
            roleType: 'tester',
            title: 'Prepare regression validation',
            description: `Define focused regression checks and validation targets for: ${requirement}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          })
          seeds.push({
            roleType: 'tester',
            title: 'Validate bugfix regression coverage',
            description: `Run the focused regression validation for: ${requirement}.`,
            dependencies: ['task-1', 'task-2'],
            reviewRequired: false,
            files: [],
          })
        }

        return this.withOptionalReviewer(seeds, includeRole('reviewer'))
      }
      case 'refactor': {
        const seeds: TaskSeed[] = [
          {
            roleType: includeRole('architect') ? 'architect' : 'analyst',
            title: 'Define refactor boundaries',
            description: `Define safe refactor boundaries, risks, and invariants for: ${requirement}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          },
        ]

        if (includeRole('tester')) {
          seeds.push({
            roleType: 'tester',
            title: 'Design refactor verification checks',
            description: `Design focused verification checks for the refactor: ${requirement}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          })
        }

        seeds.push({
          roleType: includeRole('developer') ? 'developer' : preferredRoles[0] || 'developer',
          title: 'Implement refactor changes',
          description: `Implement the refactor for: ${requirement} without changing the tech stack (${stackText}).`,
          dependencies: ['task-1'],
          reviewRequired: true,
          files: [],
        })

        if (includeRole('tester')) {
          seeds.push({
            roleType: 'tester',
            title: 'Verify refactor stability',
            description: `Run focused verification for the refactor: ${requirement}.`,
            dependencies: ['task-3', 'task-2'],
            reviewRequired: false,
            files: [],
          })
        }

        return this.withOptionalReviewer(seeds, includeRole('reviewer'))
      }
      case 'feature':
      default: {
        const seeds: TaskSeed[] = []

        if ((this.isAmbiguous(requirement) || this.isContractSensitive(requirement)) && includeRole('analyst')) {
          seeds.push({
            roleType: 'analyst',
            title: 'Clarify feature scope',
            description: `Clarify impacted areas, constraints, and acceptance targets for: ${requirement}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          })
        }

        if ((this.isContractSensitive(requirement) || this.isArchitectureHeavy(requirement)) && includeRole('architect')) {
          seeds.push({
            roleType: 'architect',
            title: 'Define architecture and contracts',
            description: `Define the architecture and interface expectations for: ${requirement} within ${stackText}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          })
        }

        if (includeRole('tester')) {
          seeds.push({
            roleType: 'tester',
            title: 'Prepare feature acceptance checks',
            description: `Prepare the validation and acceptance checks for: ${requirement}.`,
            dependencies: [],
            reviewRequired: false,
            files: [],
          })
        }

        const implementationDependencies = seeds.map((_, index) => `task-${index + 1}`)
        seeds.push({
          roleType: includeRole('developer') ? 'developer' : preferredRoles[0] || 'developer',
          title: 'Implement feature changes',
          description: `Implement the requested feature for: ${requirement}. Keep to ${stackText}.`,
          dependencies: implementationDependencies,
          reviewRequired: true,
          files: [],
        })

        if (includeRole('tester')) {
          const prepTaskId = seeds.findIndex(seed => seed.title === 'Prepare feature acceptance checks') + 1
          seeds.push({
            roleType: 'tester',
            title: 'Validate feature behavior',
            description: `Validate the implemented behavior for: ${requirement}.`,
            dependencies: prepTaskId > 0 ? [`task-${implementationDependencies.length + 1}`, `task-${prepTaskId}`] : [`task-${implementationDependencies.length + 1}`],
            reviewRequired: false,
            files: [],
          })
        }

        return this.withOptionalReviewer(seeds, includeRole('reviewer'))
      }
    }
  }

  private withOptionalReviewer(seeds: TaskSeed[], includeReviewer: boolean): TaskSeed[] {
    if (!includeReviewer || !seeds.some(seed => seed.reviewRequired)) return seeds
    const reviewTargets = seeds
      .map((seed, index) => seed.reviewRequired ? `task-${index + 1}` : null)
      .filter((taskId): taskId is string => Boolean(taskId))
    return [
      ...seeds,
      {
        roleType: 'reviewer',
        title: 'Review implementation results',
        description: 'Review all review-required implementation outputs and approve or request changes.',
        dependencies: reviewTargets,
        reviewRequired: false,
        files: [],
      },
    ]
  }

  private matches(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword))
  }

  private isAmbiguous(requirement: string): boolean {
    return this.matches(requirement.toLowerCase(), ['system', 'platform', 'workflow', 'integration', '协同', '平台', '流程'])
  }

  private isArchitectureHeavy(requirement: string): boolean {
    return this.matches(requirement.toLowerCase(), ['architecture', 'design', 'service', 'module', '架构', '模块'])
  }

  private isContractSensitive(requirement: string): boolean {
    return this.matches(requirement.toLowerCase(), ['api', 'contract', 'schema', 'interface', 'protocol', '接口', '契约', '协议'])
  }
}
