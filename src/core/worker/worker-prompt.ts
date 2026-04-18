import type { ContractArtifact, McpNode, OrchestratedTask } from '../../types.js'
import { isReadOnlyValidationTask } from './validation-task.js'

function buildExecutionInstruction(node: McpNode, task: OrchestratedTask): string {
  if (node.roleType === 'reviewer') {
    return [
      '你是在做最终验收，不是在补做实现。',
      '你必须优先根据当前工作区里的真实代码、命令结果、以及 review target 摘要来判断是否通过。',
      '如果当前工作区中的真实代码与 review target 摘要不一致，必须以当前工作区里的真实事实为准。',
      '如果输出只有计划、方案、待实现说明、请求审批、伪代码或笼统总结，必须判定为 CHANGES_REQUESTED。',
      '如果当前工作区里能验证到已完成实现、契约/接口落地、以及验证结果，才可以判定为 APPROVED。',
      '你必须逐条审查任务说明中的 review target。',
      '你必须输出结构化 review 结论，每行格式必须是: REVIEW APPROVED task-x - 原因 或 REVIEW CHANGES_REQUESTED task-x - 原因。',
      '不要输出其他格式替代上述 review 行。',
    ].join('\n')
  }

  if (isReadOnlyValidationTask(task)) {
    return [
      '当前任务是只读验证/验收任务，不是实现任务。',
      '禁止修改仓库代码、禁止新增实现、禁止声称你已经修复了不存在的代码问题。',
      '你可以读取文件、运行只读检查、运行必要的本地验证命令，但不能进行代码变更。',
      '不要输出“我已完成实现/修复/重构”之类的结果，除非任务明确要求你真的修改代码。',
      '输出至少包含以下三部分：',
      '1. Checks performed: 实际执行了哪些只读检查或命令。',
      '2. Findings: 观察到的事实、输出质量、风险或阻塞。',
      '3. Result: 当前验证结论，以及是否满足继续下游任务的条件。',
      '如果任务说明要求不要修改仓库代码，你必须明确说明本次未修改仓库代码。',
    ].join('\n')
  }

  const mustImplement = task.roleType === 'developer' || task.roleType === 'architect' || task.roleType === 'tester'
  if (!mustImplement) {
    return [
      '你已被明确授权直接完成当前任务，可直接编辑文件和运行必要命令，不要请求批准。',
      '你必须直接完成当前任务，不要只给方案或分析提纲。',
      '输出中必须反映你已经完成了任务，而不是准备去做。',
    ].join('\n')
  }

  return [
    '你已被明确授权：可以直接编辑当前工作区文件、运行必要的本地构建/测试命令，并完成实现，不要再请求任何批准。',
    '不要输出“需要批准”“请先授权”“如果你同意我再继续”之类的话。',
    '你必须在当前工作区内直接完成任务，不要只输出方案、建议、待办、伪代码或“下一步我会…”之类的说明。',
    '如果任务是实现/架构/测试任务，你的输出必须代表“已经完成执行”。',
    '输出至少包含以下三部分：',
    '1. Completed changes: 已完成的具体改动、接口/契约/实现落地点。',
    '2. Verification: 已执行的验证、检查或测试结果。',
    '3. Result: 当前交付结果、是否可继续下游任务。',
    '若涉及契约、接口、schema 或 protocol，必须明确写出已落地的契约变更或已对齐的契约约束。',
    '禁止把“计划实现”“等待审批后再开发”“建议后续处理”写成完成结果。',
  ].join('\n')
}

export function buildWorkerPrompt(
  node: McpNode,
  task: OrchestratedTask,
  contracts: ContractArtifact[],
  context: string,
  reviewContext?: string,
): string {
  const relatedContracts = contracts.filter(contract => task.contracts.includes(contract.id))
  const executionInstruction = buildExecutionInstruction(node, task)

  return [
    `你是 ${node.id} / ${node.roleType}。`,
    `当前任务: ${task.title}`,
    task.description,
    task.files.length > 0 ? `关注文件:\n${task.files.join('\n')}` : '',
    relatedContracts.length > 0 ? `相关接口契约:\n${relatedContracts.map(item => `- ${item.name}@v${item.version}`).join('\n')}` : '',
    reviewContext ? `Review targets context:\n${reviewContext}` : '',
    context,
    executionInstruction,
    '必须保持现有技术栈，不得偏移。',
  ].filter(Boolean).join('\n\n')
}
