import type { PreflightCheckResult } from '../../../types.js'
import { getBuildCommands } from '../../../utils/platform.js'

export function runBuildCheck(projectRoot: string): PreflightCheckResult {
  const commands = getBuildCommands(projectRoot)
  return {
    name: 'build',
    status: commands.length > 0 ? 'passed' : 'warning',
    message: commands.length > 0 ? `检测到构建命令: ${commands.join(', ')}` : '未检测到构建命令',
    autoFixable: false,
    category: 'build',
    currentState: commands.length > 0 ? 'detected' : 'missing-build-command',
    nextStep: commands.length > 0 ? undefined : '在 package.json scripts 或项目构建配置中补充标准构建命令。',
  }
}
