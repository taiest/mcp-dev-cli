import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENTS_DIR, PARALLEL_DIR, PARALLEL_WORKSPACES_DIR } from '../types.js'
import { detectTechStack } from '../utils/platform.js'
import { checkClaudeInstalled } from '../utils/claude-cli.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
  }

  const mcpConfigPath = join(projectRoot, '.mcp.json')
  if (!existsSync(mcpConfigPath)) {
    const template = readFileSync(join(templatesDir, 'mcp-json.hbs'), 'utf-8')
    writeFileSync(mcpConfigPath, template.replace('{{projectRoot}}', projectRoot), 'utf-8')
  }

  return [
    '✅ parallel platform initialized',
    `project: ${projectRoot}`,
    `claude: ${hasClaude ? 'available' : 'missing'}`,
    `stack: ${stack.frameworks.join(', ') || 'unknown'}`,
    `parallel dir: ${PARALLEL_DIR}`,
    'startup flow: ready',
  ].join('\n')
}
