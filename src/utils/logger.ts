import chalk from 'chalk'

const PREFIX = {
  info: chalk.blue('ℹ'),
  success: chalk.green('✅'),
  warn: chalk.yellow('⚠️'),
  error: chalk.red('❌'),
  task: chalk.cyan('📋'),
  role: chalk.magenta('👤'),
  git: chalk.yellow('🔀'),
  run: chalk.green('🚀'),
}

export const log = {
  info: (msg: string) => console.log(`${PREFIX.info}  ${msg}`),
  success: (msg: string) => console.log(`${PREFIX.success} ${msg}`),
  warn: (msg: string) => console.log(`${PREFIX.warn}  ${msg}`),
  error: (msg: string) => console.error(`${PREFIX.error} ${chalk.red(msg)}`),
  task: (msg: string) => console.log(`${PREFIX.task} ${msg}`),
  role: (msg: string) => console.log(`${PREFIX.role} ${msg}`),
  git: (msg: string) => console.log(`${PREFIX.git} ${msg}`),
  run: (msg: string) => console.log(`${PREFIX.run} ${msg}`),

  header: (title: string) => {
    const line = '━'.repeat(40)
    console.log(`\n${chalk.bold(title)}`)
    console.log(chalk.dim(line))
  },

  table: (rows: Array<[string, string]>) => {
    const maxKey = Math.max(...rows.map(([k]) => k.length))
    for (const [key, value] of rows) {
      console.log(`  ${chalk.dim(key.padEnd(maxKey))}  ${value}`)
    }
  },

  blank: () => console.log(),
}
