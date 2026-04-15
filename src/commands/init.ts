import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../utils/logger.js'
import { findProjectRoot, detectTechStack } from '../utils/platform.js'
import { checkClaudeInstalled } from '../utils/claude-cli.js'
import { AGENTS_DIR, CONTEXT_DIR, CONTRACT_DIR, CHECKPOINT_FILE } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

// 当从 dist/ 运行时，模板在 src/templates/；当从 src/ 运行时也在 src/templates/
function getTemplatesDir(): string {
  // 优先查找 src/templates（npm 包发布时 files 包含 src/templates）
  const candidates = [
    join(__dirname, '..', 'templates'),           // dist/commands/ → dist/templates (dev)
    join(__dirname, '..', '..', 'src', 'templates'), // dist/commands/ → src/templates (published)
    TEMPLATES_DIR,
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return TEMPLATES_DIR
}

export async function initCommand(): Promise<void> {
  log.header('🔧 初始化 MCP 协同开发配置')

  // 检查 claude CLI
  const hasClaude = await checkClaudeInstalled()
  if (!hasClaude) {
    log.error('未检测到 Claude Code CLI，请先安装: https://docs.anthropic.com/en/docs/claude-code')
    return
  }

  const root = findProjectRoot()
  log.info(`项目根目录: ${root}`)

  // 检测技术栈
  const stack = detectTechStack(root)
  log.info(`检测到技术栈: ${stack.frameworks.join(', ') || '未知'}`)

  const templatesDir = getTemplatesDir()

  // 1. 创建目录
  const dirs = [
    join(root, AGENTS_DIR),
    join(root, CONTEXT_DIR),
    join(root, CONTRACT_DIR),
  ]
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      log.success(`创建目录: ${dir.replace(root, '.')}`)
    }
  }

  // 2. 复制角色模板
  const agentsTemplateDir = join(templatesDir, 'agents')
  if (existsSync(agentsTemplateDir)) {
    const agents = readdirSync(agentsTemplateDir).filter(f => f.endsWith('.md'))
    for (const agent of agents) {
      const dest = join(root, AGENTS_DIR, agent)
      if (!existsSync(dest)) {
        copyFileSync(join(agentsTemplateDir, agent), dest)
        log.success(`创建角色: ${agent}`)
      } else {
        log.info(`角色已存在，跳过: ${agent}`)
      }
    }
  }

  // 3. 生成 CLAUDE.md
  const claudeMdPath = join(root, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    const template = readFileSync(join(templatesDir, 'claude-md.hbs'), 'utf-8')
    const content = template
      .replace('{{projectName}}', root.split('/').pop() || 'project')
      .replace('{{techStack}}', stack.frameworks.join(', ') || '待补充')
      .replace('{{projectStructure}}', '待补充（运行后自动检测）')
    writeFileSync(claudeMdPath, content, 'utf-8')
    log.success('创建 CLAUDE.md')
  } else {
    log.info('CLAUDE.md 已存在，跳过')
  }

  // 4. 生成 .mcp.json
  const mcpPath = join(root, '.mcp.json')
  if (!existsSync(mcpPath)) {
    const template = readFileSync(join(templatesDir, 'mcp-json.hbs'), 'utf-8')
    const content = template.replace('{{projectRoot}}', '.')
    writeFileSync(mcpPath, content, 'utf-8')
    log.success('创建 .mcp.json')
  } else {
    log.info('.mcp.json 已存在，跳过')
  }

  // 5. 生成空 checkpoint
  const cpPath = join(root, CHECKPOINT_FILE)
  if (!existsSync(cpPath)) {
    copyFileSync(join(templatesDir, 'checkpoint.json'), cpPath)
    log.success('创建 task-checkpoint.json')
  }

  // 6. 生成 api-contract README
  const contractReadme = join(root, CONTRACT_DIR, 'README.md')
  if (!existsSync(contractReadme)) {
    writeFileSync(contractReadme, '# 接口契约\n\n此目录存放前后端接口契约文件，由 mcp-dev-cli 自动管理。\n', 'utf-8')
  }

  // 7. 更新 .gitignore
  const gitignorePath = join(root, '.gitignore')
  const ignoreEntries = [
    '# Claude Code 本地缓存',
    '.claude/settings.local.json',
    '.claude/statsig/',
    '.claude/todos/',
    '.claude/credentials.json',
  ]
  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, 'utf-8')
    const missing = ignoreEntries.filter(e => !e.startsWith('#') && !existing.includes(e))
    if (missing.length > 0) {
      const append = '\n' + ignoreEntries.join('\n') + '\n'
      writeFileSync(gitignorePath, existing.trimEnd() + '\n' + append, 'utf-8')
      log.success('.gitignore 已更新')
    }
  }

  // 完成
  log.blank()
  log.header('✅ 初始化完成')
  log.table([
    ['📁 .claude/agents/', `${readdirSync(join(root, AGENTS_DIR)).filter(f => f.endsWith('.md')).length} 个角色`],
    ['📁 .claude/context/', '断点 + 契约目录'],
    ['📄 CLAUDE.md', '协作规范'],
    ['📄 .mcp.json', 'MCP 配置'],
  ])
  log.blank()
  log.info('下一步: npx mcp-dev-cli start "你的需求描述"')
}
