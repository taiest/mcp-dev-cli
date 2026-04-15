import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

export function listRoles(projectRoot: string): string {
  const agents = loadAgents(projectRoot)
  if (agents.length === 0) {
    return '没有找到角色文件。请先运行 mcp_dev_init 初始化项目。'
  }

  const lines: string[] = ['👥 角色列表', '━'.repeat(40)]
  for (const agent of agents) {
    const desc = agent.description.split('\n')[0].slice(0, 60)
    lines.push(`  👤 ${agent.name.padEnd(20)} ${desc}`)
    lines.push(`     model: ${agent.model.padEnd(14)} tools: ${agent.tools.slice(0, 40)}`)
    lines.push('')
  }
  lines.push(`共 ${agents.length} 个角色`)
  return lines.join('\n')
}

export function addRole(projectRoot: string, name: string, description: string, model = 'sonnet', tools = 'Read,Write,Edit,Glob,Grep,Bash', color = 'white'): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return '❌ 名称格式错误：仅支持小写字母、数字和连字符，必须字母开头'
  }

  const filePath = join(projectRoot, AGENTS_DIR, `${name}.md`)
  if (existsSync(filePath)) {
    return `❌ 角色 ${name} 已存在`
  }

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
  return `✅ 角色 ${name} 已创建: ${filePath}`
}

export function removeRole(projectRoot: string, name: string): string {
  const filePath = join(projectRoot, AGENTS_DIR, `${name}.md`)
  if (!existsSync(filePath)) {
    return `❌ 角色 ${name} 不存在`
  }

  unlinkSync(filePath)
  return `✅ 角色 ${name} 已删除`
}
