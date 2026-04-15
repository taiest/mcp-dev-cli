// MCP Server 模式下，日志收集为纯文本（不再输出到 console）

export class LogCollector {
  private lines: string[] = []

  info(msg: string) { this.lines.push(`ℹ  ${msg}`) }
  success(msg: string) { this.lines.push(`✅ ${msg}`) }
  warn(msg: string) { this.lines.push(`⚠️  ${msg}`) }
  error(msg: string) { this.lines.push(`❌ ${msg}`) }
  task(msg: string) { this.lines.push(`📋 ${msg}`) }
  role(msg: string) { this.lines.push(`👤 ${msg}`) }
  git(msg: string) { this.lines.push(`🔀 ${msg}`) }
  run(msg: string) { this.lines.push(`🚀 ${msg}`) }

  header(title: string) {
    this.lines.push('')
    this.lines.push(title)
    this.lines.push('━'.repeat(40))
  }

  table(rows: Array<[string, string]>) {
    const maxKey = Math.max(...rows.map(([k]) => k.length))
    for (const [key, value] of rows) {
      this.lines.push(`  ${key.padEnd(maxKey)}  ${value}`)
    }
  }

  blank() { this.lines.push('') }

  flush(): string {
    const result = this.lines.join('\n')
    this.lines = []
    return result
  }

  peek(): string {
    return this.lines.join('\n')
  }
}

// 全局单例，各模块共享
export const log = new LogCollector()
