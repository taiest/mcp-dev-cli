import { runClaude } from '../utils/claude-cli.js'
import type { TaskPlan, Config } from '../types.js'
import { log } from '../utils/logger.js'

const SPLIT_SYSTEM_PROMPT = `你是一个任务拆分专家。你的职责是分析用户的开发需求，结合项目代码结构，将需求拆分为可并行执行的原子子任务。

规则：
1. 每个子任务必须是独立可执行的，有明确的输入和输出
2. 标注子任务之间的依赖关系（哪些必须先完成）
3. 为每个子任务指定最合适的角色：frontend-skill / backend-skill / test-skill / pm-agent
4. 列出每个子任务需要修改的文件路径
5. 为每个子任务编写完整的 prompt（给 Claude 的指令）
6. 如果前后端有交互，定义接口契约

你必须严格输出以下 JSON 格式，不要输出其他内容：

{
  "tasks": [
    {
      "id": "task-1",
      "role": "backend-skill",
      "title": "简短标题",
      "description": "详细描述",
      "prompt": "给 Claude 的完整开发指令，包含具体要求和文件路径",
      "files": ["file1.go", "file2.go"],
      "dependencies": []
    }
  ],
  "merge_order": ["task-1", "task-2"],
  "api_contracts": [
    {
      "name": "contract-name",
      "content": "接口定义内容（请求/响应结构、URL、方法）"
    }
  ]
}

注意：
- task id 格式为 task-N
- merge_order 是拓扑排序后的合并顺序
- 无依赖的任务可以并行执行
- api_contracts 仅在前后端有交互时需要
- prompt 字段要足够详细，让独立的 Claude 进程能直接执行`

export class TaskSplitter {
  private config: Config

  constructor(config: Config) {
    this.config = config
  }

  async split(requirement: string): Promise<TaskPlan> {
    log.task('正在分析需求并拆分任务...')

    const prompt = `请分析以下开发需求，结合当前项目的代码结构，拆分为可并行的子任务。

## 需求
${requirement}

${this.config.contextSummaryText ? `${this.config.contextSummaryText}\n\n` : ''}请先用 Read/Glob/Grep 工具分析项目结构，然后输出任务拆分 JSON。`

    const result = await runClaude({
      prompt,
      systemPrompt: SPLIT_SYSTEM_PROMPT,
      model: this.config.model,
      outputFormat: 'json',
      allowedTools: 'Read,Glob,Grep',
      cwd: this.config.projectRoot,
    })

    try {
      const parsed = JSON.parse(result)
      const content = parsed.result || parsed
      if (typeof content === 'string') {
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as TaskPlan
        }
      }
      return content as TaskPlan
    } catch (e) {
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as TaskPlan
      }
      throw new Error(`任务拆分结果解析失败: ${(e as Error).message}`)
    }
  }
}
