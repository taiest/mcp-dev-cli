import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContextSummary } from '../types.js'
import { CONTEXT_FILES, CONTEXT_DIR } from '../types.js'

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function readText(filePath: string): string {
  if (!existsSync(filePath)) return ''
  return readFileSync(filePath, 'utf-8').trim()
}

function writeText(filePath: string, content: string): void {
  writeFileSync(filePath, content.trim() + '\n', 'utf-8')
}

export class ContextStore {
  private root: string
  private dir: string

  constructor(projectRoot: string) {
    this.root = projectRoot
    this.dir = join(projectRoot, CONTEXT_DIR)
  }

  ensureFiles(): void {
    ensureDir(this.dir)

    const defaults: Record<string, string> = {
      [CONTEXT_FILES.sessionBrief]: '# Session Brief\n\n',
      [CONTEXT_FILES.productContext]: '# Product Context\n\n',
      [CONTEXT_FILES.screenshotAnalysis]: '# Screenshot Analysis\n\n',
      [CONTEXT_FILES.implementationPlan]: '# Implementation Plan\n\n',
      [CONTEXT_FILES.discoveredRisks]: '# Discovered Risks\n\n',
      [CONTEXT_FILES.executionHandoff]: '# Execution Handoff\n\n',
    }

    for (const [file, content] of Object.entries(defaults)) {
      const filePath = join(this.root, file)
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content, 'utf-8')
      }
    }
  }

  save(summary: ContextSummary): string[] {
    this.ensureFiles()

    const written: string[] = []

    if (summary.goal || summary.phase || summary.nextSteps?.length) {
      const content = [
        '# Session Brief',
        '',
        summary.goal ? `## Goal\n${summary.goal}` : '',
        summary.phase ? `\n## Phase\n${summary.phase}` : '',
        summary.nextSteps?.length ? `\n## Next Steps\n${summary.nextSteps.map(step => `- ${step}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')
      writeText(join(this.root, CONTEXT_FILES.sessionBrief), content)
      written.push(CONTEXT_FILES.sessionBrief)
    }

    if (summary.constraints?.length) {
      const content = [
        '# Product Context',
        '',
        '## Constraints',
        summary.constraints.map(item => `- ${item}`).join('\n'),
      ].join('\n')
      writeText(join(this.root, CONTEXT_FILES.productContext), content)
      written.push(CONTEXT_FILES.productContext)
    }

    if (summary.analysis) {
      const content = ['# Screenshot Analysis', '', summary.analysis].join('\n')
      writeText(join(this.root, CONTEXT_FILES.screenshotAnalysis), content)
      written.push(CONTEXT_FILES.screenshotAnalysis)
    }

    if (summary.plan) {
      const content = ['# Implementation Plan', '', summary.plan].join('\n')
      writeText(join(this.root, CONTEXT_FILES.implementationPlan), content)
      written.push(CONTEXT_FILES.implementationPlan)
    }

    if (summary.risks?.length) {
      const content = [
        '# Discovered Risks',
        '',
        summary.risks.map(item => `- ${item}`).join('\n'),
      ].join('\n')
      writeText(join(this.root, CONTEXT_FILES.discoveredRisks), content)
      written.push(CONTEXT_FILES.discoveredRisks)
    }

    if (summary.goal || summary.nextSteps?.length || summary.risks?.length) {
      const content = [
        '# Execution Handoff',
        '',
        summary.goal ? `## Goal\n${summary.goal}` : '',
        summary.risks?.length ? `\n## Risks\n${summary.risks.map(item => `- ${item}`).join('\n')}` : '',
        summary.nextSteps?.length ? `\n## Next Steps\n${summary.nextSteps.map(item => `- ${item}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')
      writeText(join(this.root, CONTEXT_FILES.executionHandoff), content)
      written.push(CONTEXT_FILES.executionHandoff)
    }

    return written
  }

  load(): ContextSummary | null {
    const sessionBrief = readText(join(this.root, CONTEXT_FILES.sessionBrief))
    const productContext = readText(join(this.root, CONTEXT_FILES.productContext))
    const screenshotAnalysis = readText(join(this.root, CONTEXT_FILES.screenshotAnalysis))
    const implementationPlan = readText(join(this.root, CONTEXT_FILES.implementationPlan))
    const discoveredRisks = readText(join(this.root, CONTEXT_FILES.discoveredRisks))
    const executionHandoff = readText(join(this.root, CONTEXT_FILES.executionHandoff))

    const summary: ContextSummary = {
      goal: extractSection(sessionBrief, 'Goal') || extractFirstBody(sessionBrief),
      phase: extractSection(sessionBrief, 'Phase'),
      constraints: extractBulletList(productContext),
      analysis: extractFirstBody(screenshotAnalysis),
      plan: extractFirstBody(implementationPlan),
      risks: extractBulletList(discoveredRisks),
      nextSteps: extractSectionBullets(sessionBrief, 'Next Steps').length > 0
        ? extractSectionBullets(sessionBrief, 'Next Steps')
        : extractSectionBullets(executionHandoff, 'Next Steps'),
    }

    if (!summary.goal && !summary.analysis && !summary.plan && summary.constraints.length === 0 && summary.risks.length === 0 && summary.nextSteps.length === 0) {
      return null
    }

    return summary
  }

  buildSummaryText(summary: ContextSummary | null): string {
    if (!summary) return ''

    const sections: string[] = ['## 已恢复上下文']
    if (summary.goal) sections.push(`- 当前目标: ${summary.goal}`)
    if (summary.phase) sections.push(`- 当前阶段: ${summary.phase}`)
    if (summary.constraints.length > 0) sections.push(`- 已确认约束: ${summary.constraints.join('；')}`)
    if (summary.risks.length > 0) sections.push(`- 已知风险: ${summary.risks.join('；')}`)
    if (summary.nextSteps.length > 0) sections.push(`- 下一步建议: ${summary.nextSteps.join('；')}`)
    if (summary.analysis) sections.push(`- 分析摘要: ${summary.analysis.slice(0, 300)}`)
    return sections.join('\n')
  }

}

function extractFirstBody(content: string): string {
  return content
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .join('\n')
    .trim()
}

function extractSection(content: string, name: string): string {
  const match = content.match(new RegExp(`## ${escapeRegExp(name)}\\n([\\s\\S]*?)(?:\\n## |$)`))
  return match?.[1]?.trim() || ''
}

function extractBulletList(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
}

function extractSectionBullets(content: string, name: string): string[] {
  return extractSection(content, name)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim())
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
