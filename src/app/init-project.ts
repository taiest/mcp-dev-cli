import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENTS_DIR, PARALLEL_DIR, PARALLEL_WORKSPACES_DIR } from '../types.js'
import { detectTechStack } from '../utils/platform.js'
import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { normalizeProjectMcpConfig } from '../utils/mcp-config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PARALLEL_WORKFLOW_RULES = `## MCP 多角色并行开发流程（必须遵守）

当收到任何开发、修复、重构、新增功能等任务时，**禁止自己直接编码**，必须按以下流程执行：

1. **启动检查**：调用 \`parallel_startup\` 查看项目状态和环境
2. **录入需求**：调用 \`parallel_requirement\` 录入本轮需求，系统自动分析
3. **生成计划**：调用 \`parallel_start\` 生成多角色执行计划（含任务拆分、角色分配、依赖关系）
4. **确认执行**：调用 \`parallel_approve\` 启动并行执行，多个 MCP 角色同时工作
5. **查看进度**：调用 \`parallel_dashboard\` 查看实时执行状态
6. **查看对话**：调用 \`parallel_messages\` 查看指定 MCP 角色的对话记录

### 严格规则
- **不要自己一个人写代码**，所有开发任务必须通过并行流程分配给多个 MCP 角色执行
- **不要跳过 parallel_start**，直接编码会导致没有任务拆分和角色协同
- **不要手动修改 mcp/ 前缀的分支**，这些由并行系统自动管理
- 如果需要追加修改，使用 \`parallel_patch\` 而不是自己改`

function getTemplatesDir(): string {
  const candidates = [join(__dirname, '..', 'templates'), join(__dirname, '..', '..', 'src', 'templates')]
  return candidates.find(dir => existsSync(dir)) || candidates[0]!
}

export async function initProjectApp(projectRoot: string): Promise<string> {
  const hasClaude = await checkClaudeInstalled()
  const stack = detectTechStack(projectRoot)
  const templatesDir = getTemplatesDir()

  for (const dir of [join(projectRoot, AGENTS_DIR), join(projectRoot, PARALLEL_DIR), join(projectRoot, PARALLEL_WORKSPACES_DIR)]) {
    mkdirSync(dir, { recursive: true })
  }

  const agentsTemplateDir = join(templatesDir, 'agents')
  if (existsSync(agentsTemplateDir)) {
    for (const agent of readdirSync(agentsTemplateDir).filter(file => file.endsWith('.md'))) {
      const dest = join(projectRoot, AGENTS_DIR, agent)
      if (!existsSync(dest)) copyFileSync(join(agentsTemplateDir, agent), dest)
    }
  }

  const claudeMdPath = join(projectRoot, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    const template = readFileSync(join(templatesDir, 'claude-md.hbs'), 'utf-8')
    writeFileSync(claudeMdPath, template
      .replace('{{projectName}}', projectRoot.split('/').pop() || 'project')
      .replace('{{techStack}}', stack.frameworks.join(', ') || '待补充')
      .replace('{{projectStructure}}', 'parallel platform layout'), 'utf-8')
  } else {
    const existing = readFileSync(claudeMdPath, 'utf-8')
    if (!existing.includes('MCP 多角色并行开发流程')) {
      writeFileSync(claudeMdPath, existing + '\n' + PARALLEL_WORKFLOW_RULES + '\n', 'utf-8')
    }
  }

  const mcpConfigPath = join(projectRoot, '.mcp.json')
  if (!existsSync(mcpConfigPath)) {
    const template = readFileSync(join(templatesDir, 'mcp-json.hbs'), 'utf-8')
    writeFileSync(mcpConfigPath, template.replace('{{projectRoot}}', projectRoot), 'utf-8')
  }

  const mcpConfigResult = normalizeProjectMcpConfig(projectRoot)

  return [
    '✅ parallel platform initialized',
    `project: ${projectRoot}`,
    `claude: ${hasClaude ? 'available' : 'missing'}`,
    `stack: ${stack.frameworks.join(', ') || 'unknown'}`,
    `parallel dir: ${PARALLEL_DIR}`,
    `mcp config: ${mcpConfigResult.updated ? 'normalized' : 'already-ready'}`,
    'startup flow: ready',
  ].join('\n')
}
