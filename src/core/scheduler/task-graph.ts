import type {
  ControllerLaneRecommendation,
  McpRoleType,
  OrchestratedTask,
  RequirementAnalysis,
  RequirementClarity,
  RequirementKind,
  RequirementRisk,
  TaskGraph,
} from '../../types.js'
import { detectTechStack } from '../../utils/platform.js'
import { isReadOnlyValidationText } from '../worker/validation-task.js'

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
    this.ensureMinimumParallelism(seeds, kind, requirement)
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
      reassignmentCount: 0,
      previousAssignments: [],
    }))
    const analysis = this.buildAnalysis(kind, requirement, seeds, preferredRoles)
    return { tasks, analysis }
  }

  private classifyRequirement(requirement: string): RequirementKind {
    // Check explicit development intent first — overrides analysis keywords
    if (this.matches(requirement, ['开发', '实现', '重构', '新增', '改造', 'implement', 'develop', 'build', 'create', 'add'])) {
      if (this.matches(requirement, ['refactor', 'restructure', '重构'])) return 'refactor'
      return 'feature'
    }
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

  private buildAnalysis(
    kind: RequirementKind,
    requirement: string,
    seeds: TaskSeed[],
    preferredRoles: McpRoleType[]
  ): RequirementAnalysis {
    const likelyLandingZones = this.buildLandingZones(kind, requirement, seeds)
    const recommendedRoles = preferredRoles.filter(role => seeds.some(seed => seed.roleType === role))
    const clarity = this.buildClarity(kind, requirement)
    const clarityHints = this.buildClarityHints(kind, requirement, seeds, clarity)
    const riskLevel = this.buildRiskLevel(kind, requirement)
    const riskHints = this.buildRiskHints(kind, requirement)
    const laneRoleRecommendations = this.buildLaneRoleRecommendations(seeds)
    const estimatedParallelism = this.estimateParallelism(seeds)
    const recommendedExecutionLaneCount = laneRoleRecommendations.reduce((sum, lane) => sum + lane.count, 0)
    const recommendedTotalMcpCount = Math.max(2, recommendedExecutionLaneCount + 1)
    const decompositionStrategy = this.buildDecompositionStrategy(kind, seeds, clarity, riskLevel)
    const controllerReasoning = this.buildControllerReasoning({
      kind,
      clarity,
      riskLevel,
      estimatedParallelism,
      recommendedExecutionLaneCount,
      recommendedTotalMcpCount,
      laneRoleRecommendations,
      seeds,
    })
    const controllerSummary = `MCP-01 评估当前需求属于 ${kind}，建议创建 ${recommendedExecutionLaneCount} 个执行 lane（总 MCP ${recommendedTotalMcpCount}），按 ${decompositionStrategy} 推进。`

    return {
      kind,
      likelyLandingZones,
      recommendedRoles,
      clarity,
      clarityHints,
      riskLevel,
      riskHints,
      estimatedParallelism,
      recommendedExecutionLaneCount,
      recommendedTotalMcpCount,
      laneRoleRecommendations,
      decompositionStrategy,
      controllerSummary,
      controllerReasoning,
    }
  }

  private ensureMinimumParallelism(seeds: TaskSeed[], kind: RequirementKind, requirement: string): void {
    if (kind === 'analysis' || kind === 'docs' || kind === 'validation') return
    if (new Set(seeds.map(s => s.roleType)).size >= 2) return
    const hasTester = seeds.some(s => s.roleType === 'tester')
    const hasDeveloper = seeds.some(s => s.roleType === 'developer')
    if (!hasTester) {
      const devTaskId = seeds.findIndex(s => s.roleType === 'developer') + 1
      seeds.push({
        roleType: 'tester',
        title: 'Validate implementation',
        description: `Validate the implementation result for: ${requirement}.`,
        dependencies: devTaskId > 0 ? [`task-${devTaskId}`] : [],
        reviewRequired: false,
        files: [],
      })
    }
    if (!hasDeveloper) {
      seeds.push({
        roleType: 'developer',
        title: 'Implement changes',
        description: `Implement the required changes for: ${requirement}.`,
        dependencies: [],
        reviewRequired: true,
        files: [],
      })
    }
  }

  private buildLandingZones(kind: RequirementKind, requirement: string, seeds: TaskSeed[]): string[] {
    const fromSeeds = Array.from(new Set(seeds.flatMap(seed => seed.files).filter(Boolean)))
    if (fromSeeds.length > 0) return fromSeeds

    const lower = requirement.toLowerCase()
    const zones: string[] = []

    if (kind === 'docs') zones.push('README.md', 'docs/**')
    if (kind === 'validation') zones.push('src/**', 'tests/**')
    if (kind === 'bugfix' || kind === 'refactor' || kind === 'feature') zones.push('src/**', 'tests/**')
    if (this.matches(lower, ['api', 'contract', 'schema', 'interface', 'protocol', '接口', '契约', '协议'])) {
      zones.push('src/**', 'contracts/**', 'schemas/**')
    }
    if (this.matches(lower, ['readme', 'docs', 'documentation', '文档'])) zones.push('README.md', 'docs/**')
    if (this.matches(lower, ['config', 'env', 'setting', '配置'])) zones.push('*.json', '*.yaml', '*.yml', '.claude/**')

    return Array.from(new Set(zones)).filter(Boolean)
  }

  private buildClarity(kind: RequirementKind, requirement: string): RequirementClarity {
    if (kind === 'validation') return 'clear'
    if (this.isAmbiguous(requirement)) return 'ambiguous'
    if (this.isArchitectureHeavy(requirement) || this.isContractSensitive(requirement)) return 'mixed'
    return 'clear'
  }

  private buildClarityHints(
    kind: RequirementKind,
    requirement: string,
    seeds: TaskSeed[],
    clarity: RequirementClarity
  ): string[] {
    const hints: string[] = []

    if (clarity === 'ambiguous') {
      hints.push('requirement wording is broad and may span multiple modules')
    }
    if (this.isContractSensitive(requirement)) {
      hints.push('interface or schema impact should be confirmed before dispatch')
    }
    if (this.isArchitectureHeavy(requirement)) {
      hints.push('architecture boundary is involved and should be reviewed early')
    }
    if (kind === 'feature' && !seeds.some(seed => seed.roleType === 'analyst')) {
      hints.push('feature scope looks actionable with current requirement text')
    }
    if (kind === 'bugfix') {
      hints.push('regression target should stay focused on the reported failure path')
    }

    return hints.length > 0 ? hints : ['requirement is specific enough to enter controlled planning']
  }

  private buildRiskLevel(kind: RequirementKind, requirement: string): RequirementRisk {
    if (kind === 'validation' || kind === 'docs') return 'low'
    if (kind === 'bugfix' || kind === 'refactor') return 'high'
    if (this.isContractSensitive(requirement) || this.isArchitectureHeavy(requirement) || this.isAmbiguous(requirement)) {
      return 'high'
    }
    return kind === 'analysis' ? 'medium' : 'medium'
  }

  private buildRiskHints(kind: RequirementKind, requirement: string): string[] {
    const hints: string[] = []

    if (kind === 'validation') hints.push('stay read-only and avoid repository mutations during verification')
    if (kind === 'bugfix') hints.push('bugfix work needs regression checks before merge')
    if (kind === 'refactor') hints.push('refactor work must preserve current behavior and contracts')
    if (this.isContractSensitive(requirement)) hints.push('contract changes may affect multiple MCP lanes and review flow')
    if (this.isArchitectureHeavy(requirement)) hints.push('cross-module coordination risk is higher than single-file edits')

    return hints.length > 0 ? hints : ['standard planning, implementation, validation, and review flow applies']
  }

  private buildLaneRoleRecommendations(seeds: TaskSeed[]): ControllerLaneRecommendation[] {
    const grouped = new Map<McpRoleType, { count: number; reasons: Set<string> }>()

    for (const seed of seeds) {
      const entry = grouped.get(seed.roleType) || { count: 0, reasons: new Set<string>() }
      entry.count += 1
      entry.reasons.add(this.laneReasonForSeed(seed))
      grouped.set(seed.roleType, entry)
    }

    return Array.from(grouped.entries())
      .map(([roleType, entry]) => ({
        roleType,
        count: roleType === 'reviewer' ? 1 : entry.count,
        reason: Array.from(entry.reasons).join('；'),
      }))
      .sort((left, right) => left.roleType.localeCompare(right.roleType))
  }

  private laneReasonForSeed(seed: TaskSeed): string {
    if (seed.roleType === 'analyst') return '前置范围分析与需求澄清要先独立推进'
    if (seed.roleType === 'architect') return '接口/架构边界需要单独拉出控制面 lane'
    if (seed.roleType === 'developer') return '实现任务需要持续消费分析/架构结果'
    if (seed.roleType === 'tester') return '验证 lane 可与实现并行准备并在实现后立即接管'
    if (seed.roleType === 'reviewer') return '存在 reviewRequired 任务，需要独立复审 lane'
    return '主控建议保留该角色的独立执行 lane'
  }

  private estimateParallelism(seeds: TaskSeed[]): number {
    const zeroDependencyTasks = seeds.filter(seed => seed.dependencies.length === 0).length
    const roleCount = new Set(seeds.map(seed => seed.roleType)).size
    return Math.max(1, Math.min(seeds.length, Math.max(zeroDependencyTasks, roleCount)))
  }

  private buildDecompositionStrategy(
    kind: RequirementKind,
    seeds: TaskSeed[],
    clarity: RequirementClarity,
    riskLevel: RequirementRisk
  ): string {
    if (kind === 'validation') return '单 lane 只读验证'
    if (kind === 'docs') return '轻量单 lane 文档更新'
    if (clarity === 'ambiguous') return '先分析澄清，再按角色并行推进'
    if (riskLevel === 'high') return '前置分析/架构 + 实现/验证分 lane + 独立 review'
    if (seeds.some(seed => seed.roleType === 'tester') && seeds.some(seed => seed.roleType === 'developer')) {
      return '验证前置准备，与实现 lane 并行衔接'
    }
    return '按角色拆 lane，主控持续派发'
  }

  private buildControllerReasoning(input: {
    kind: RequirementKind
    clarity: RequirementClarity
    riskLevel: RequirementRisk
    estimatedParallelism: number
    recommendedExecutionLaneCount: number
    recommendedTotalMcpCount: number
    laneRoleRecommendations: ControllerLaneRecommendation[]
    seeds: TaskSeed[]
  }): string[] {
    const reasons = [
      `任务图共 ${input.seeds.length} 个任务，预计可同时推进 ${input.estimatedParallelism} 条 lane。`,
      `当前风险等级 ${input.riskLevel}，因此主控建议总 MCP 数量为 ${input.recommendedTotalMcpCount}（含 MCP-01 主控）。`,
      `执行 lane 数量定为 ${input.recommendedExecutionLaneCount}，避免固定 6 节点的空转或欠配。`,
    ]

    if (input.clarity !== 'clear') {
      reasons.push(`需求清晰度为 ${input.clarity}，需要先投放 analyst/architect lane 再进入开发。`)
    }

    for (const lane of input.laneRoleRecommendations) {
      reasons.push(`${lane.roleType} × ${lane.count}: ${lane.reason}`)
    }

    return reasons
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
