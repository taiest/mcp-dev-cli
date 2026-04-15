import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../utils/logger.js'
import { ask, confirm, choose } from '../utils/prompt.js'
import { findProjectRoot } from '../utils/platform.js'
import { AGENTS_DIR } from '../types.js'
import type { AgentConfig } from '../types.js'

function loadAgents(root: string): AgentConfig[] {
  const dir = join(root, AGENTS_DIR)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const raw = readFileSync(join(dir, f), 'utf-8')
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      if (!match) return null

      const meta: Record<string, string> = {}
      let currentKey = ''
      for (const line of match[1].split('\n')) {
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
          currentKey = line.slice(0, colonIdx).trim()
          meta[currentKey] = line.slice(colonIdx + 1).trim()
        } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
          meta[currentKey] += ' ' + line.trim()
        }
      }

      return {
        name: meta['name'] || f.replace('.md', ''),
        description: (meta['description'] || '').replace(/\|/g, '').trim(),
        tools: meta['tools'] || '',
        model: meta['model'] || 'sonnet',
        color: meta['color'] || 'white',
        content: match[2].trim(),
      } as AgentConfig
    })
    .filter((a): a is AgentConfig => a !== null)
}

export async function rolesCommand(action?: string): Promise<void> {
  const root = findProjectRoot()

  if (action === 'add') {
    await addRole(root)
  } else if (action === 'remove') {
    await removeRole(root)
  } else {
    await listRoles(root)
  }
}

async function listRoles(root: string): Promise<void> {
  const agents = loadAgents(root)
  if (agents.length === 0) {
    log.warn('没有找到角色文件。运行 `mcp-dev-cli init` 初始化。')
    return
  }

  log.header('👥 角色列表')
  for (const agent of agents) {
    const desc = agent.description.split('\n')[0].slice(0, 60)
    console.log(`  👤 ${agent.name.padEnd(20)} ${desc}`)
    console.log(`     ${`model: ${agent.model}`.padEnd(20)} tools: ${agent.tools.slice(0, 40)}`)
    console.log()
  }
  log.info(`共 ${agents.length} 个角色 (${join(root, AGENTS_DIR)})`)
}

async function addRole(root: string): Promise<void> {
  log.header('➕ 新增自定义角色')

  const name = await ask('角色英文名称 (小写+连字符，如 devops-skill)')
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
    log.error('名称格式错误：仅支持小写字母、数字和连字符，必须字母开头')
    return
  }

  const filePath = join(root, AGENTS_DIR, `${name}.md`)
  if (existsSync(filePath)) {
    log.error(`角色 ${name} 已存在`)
    return
  }

  const description = await ask('角色描述 (一句话说明职责)')
  const model = await ask('模型', 'sonnet')
  const tools = await ask('工具列表', 'Read,Write,Edit,Glob,Grep,Bash')
  const color = await ask('终端颜色 (red/green/yellow/blue/magenta/cyan)', 'white')

  const content = `---
name: ${name}
description: |
  ${description}
tools: ${tools}
model: ${model}
color: ${color}
---

## 职责

${description}

## 工作流程

1. 阅读任务描述和接口契约
2. 分析现有代码结构
3. 按项目规范完成开发
4. 完成后自检编译

## 输出规范

- 遵循项目现有代码风格
- 不引入不必要的依赖
- 确保代码可编译通过
`

  writeFileSync(filePath, content, 'utf-8')
  log.success(`角色 ${name} 已创建: ${filePath}`)
}

async function removeRole(root: string): Promise<void> {
  const agents = loadAgents(root)
  if (agents.length === 0) {
    log.warn('没有角色可删除')
    return
  }

  const idx = await choose('选择要删除的角色', agents.map(a => `${a.name} — ${a.description.split('\n')[0].slice(0, 40)}`))
  if (idx < 0) {
    log.warn('无效选择')
    return
  }

  const agent = agents[idx]!
  const ok = await confirm(`确认删除角色 ${agent.name}？`)
  if (!ok) return

  const filePath = join(root, AGENTS_DIR, `${agent.name}.md`)
  unlinkSync(filePath)
  log.success(`角色 ${agent.name} 已删除`)
}
