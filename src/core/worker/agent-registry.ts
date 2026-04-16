import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentConfig } from '../../types.js'
import { AGENTS_DIR } from '../../types.js'

export class AgentRegistry {
  constructor(private projectRoot: string) {}

  list(): AgentConfig[] {
    const dir = join(this.projectRoot, AGENTS_DIR)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(file => file.endsWith('.md'))
      .map(file => this.load(file.replace(/\.md$/, '')))
      .filter((value): value is AgentConfig => value !== null)
  }

  load(role: string): AgentConfig | null {
    const filePath = join(this.projectRoot, AGENTS_DIR, `${role}.md`)
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8')
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!match) return null
    const meta: Record<string, string> = {}
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':')
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    return {
      name: meta.name || role,
      description: meta.description || '',
      tools: meta.tools || '',
      model: meta.model || 'sonnet',
      color: meta.color || 'white',
      content: match[2].trim(),
    }
  }
}
