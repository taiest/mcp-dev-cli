import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiContract } from '../types.js'
import { CONTRACT_DIR } from '../types.js'

export class ContractManager {
  private dir: string

  constructor(projectRoot: string) {
    this.dir = join(projectRoot, CONTRACT_DIR)
  }

  ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true })
    }
  }

  save(contracts: ApiContract[]): void {
    this.ensureDir()
    for (const contract of contracts) {
      const filePath = join(this.dir, `${contract.name}.md`)
      writeFileSync(filePath, contract.content, 'utf-8')
    }
  }

  loadAll(): string {
    if (!existsSync(this.dir)) return ''
    const files = readdirSync(this.dir).filter(f => f.endsWith('.md') && f !== 'README.md')
    if (files.length === 0) return ''

    return files.map(f => {
      const content = readFileSync(join(this.dir, f), 'utf-8')
      return `## ${f.replace('.md', '')}\n\n${content}`
    }).join('\n\n---\n\n')
  }

  list(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir).filter(f => f.endsWith('.md') && f !== 'README.md')
  }
}
