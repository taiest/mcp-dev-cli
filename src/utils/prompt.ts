import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import chalk from 'chalk'

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  const suffix = defaultValue ? chalk.dim(` [${defaultValue}]`) : ''
  return new Promise(resolve => {
    rl.question(`${question}${suffix}: `, answer => {
      rl.close()
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await ask(`${question} [${hint}]`)
  if (!answer) return defaultYes
  return answer.toLowerCase().startsWith('y')
}

export async function choose(title: string, options: string[]): Promise<number> {
  console.log(`\n${chalk.bold(title)}`)
  options.forEach((opt, i) => {
    console.log(`  ${chalk.cyan(`${i + 1}.`)} ${opt}`)
  })
  const answer = await ask(`\n请选择 [1-${options.length}]`)
  const num = parseInt(answer, 10)
  if (isNaN(num) || num < 1 || num > options.length) return -1
  return num - 1
}

export async function multiLineInput(prompt: string): Promise<string> {
  console.log(`${prompt} ${chalk.dim('(输入空行结束)')}`)
  const rl = createInterface({ input: stdin, output: stdout })
  const lines: string[] = []
  return new Promise(resolve => {
    rl.on('line', line => {
      if (line === '') {
        rl.close()
        resolve(lines.join('\n'))
      } else {
        lines.push(line)
      }
    })
  })
}
