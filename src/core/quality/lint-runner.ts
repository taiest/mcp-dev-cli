import { execa } from 'execa'
import { getQualityCommands } from '../../utils/platform.js'

export class LintRunner {
  async run(projectRoot: string): Promise<boolean> {
    const commands = getQualityCommands(projectRoot).lint
    if (commands.length === 0) return true

    for (const command of commands) {
      const result = await execa(command, {
        cwd: projectRoot,
        shell: true,
        reject: false,
        timeout: 600_000,
      })
      if (result.exitCode !== 0) return false
    }

    return true
  }
}
