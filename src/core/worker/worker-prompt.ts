import type { ContractArtifact, McpNode, OrchestratedTask } from '../../types.js'

export function buildWorkerPrompt(node: McpNode, task: OrchestratedTask, contracts: ContractArtifact[], context: string): string {
  const relatedContracts = contracts.filter(contract => task.contracts.includes(contract.id))
  const reviewerInstruction = node.roleType === 'reviewer'
    ? [
        '你必须逐条审查任务说明中的 review target。',
        '你必须输出结构化 review 结论，每行格式必须是: REVIEW APPROVED task-x - 原因 或 REVIEW CHANGES_REQUESTED task-x - 原因。',
        '不要输出其他格式替代上述 review 行。',
      ].join('\n')
    : ''

  return [
    `你是 ${node.id} / ${node.roleType}。`,
    `当前任务: ${task.title}`,
    task.description,
    task.files.length > 0 ? `关注文件:\n${task.files.join('\n')}` : '',
    relatedContracts.length > 0 ? `相关接口契约:\n${relatedContracts.map(item => `- ${item.name}@v${item.version}`).join('\n')}` : '',
    context,
    reviewerInstruction,
    `必须保持现有技术栈，不得偏移。`,
  ].filter(Boolean).join('\n\n')
}
