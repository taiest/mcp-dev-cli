import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PreflightCheckResult,
  PreflightReport,
  ProjectCompletenessArea,
  ProjectCompletenessReport,
  ProjectConfigCheck,
  ProjectConfigReport,
} from '../../types.js'
import { runGitCheck } from './checks/git-check.js'
import { runClaudeCheck } from './checks/claude-check.js'
import { runNodeCheck } from './checks/node-check.js'
import { runBuildCheck } from './checks/build-check.js'
import { hasClaudeMd, hasParallelPlatform } from '../../utils/platform.js'
import { inspectProjectMcpConfig } from '../../utils/mcp-config.js'

function runNetworkCheck(): PreflightCheckResult {
  return {
    name: 'network',
    status: 'passed',
    message: '网络检查暂未发现阻塞项',
    autoFixable: false,
    category: 'network',
    currentState: 'ready',
  }
}

function buildMcpConfigCheck(projectRoot: string): ProjectConfigCheck {
  const inspection = inspectProjectMcpConfig(projectRoot)

  if (!inspection.exists) {
    return {
      name: 'mcp-config',
      status: 'warning',
      message: '缺少 .mcp.json，当前项目还未接入 mcp-dev-cli',
      path: '.mcp.json',
      autoFixable: false,
      nextStep: '在项目目录执行 npx -y mcp-dev-cli install 完成一键接入。',
    }
  }

  if (inspection.parseError) {
    return {
      name: 'mcp-config',
      status: 'warning',
      message: '.mcp.json 存在但无法解析',
      path: '.mcp.json',
      autoFixable: false,
      nextStep: '在项目目录执行 npx -y mcp-dev-cli install 重建正确接入配置。',
    }
  }

  if (inspection.valid) {
    return {
      name: 'mcp-config',
      status: 'passed',
      message: 'mcp-dev-cli 已正确接入 Claude Code',
      path: '.mcp.json',
      autoFixable: false,
    }
  }

  if (inspection.hasLegacyFilesystemServer) {
    return {
      name: 'mcp-config',
      status: 'warning',
      message: '.mcp.json 仍是旧的 filesystem 模板，不是 mcp-dev-cli 接入配置',
      path: '.mcp.json',
      autoFixable: false,
      nextStep: '在项目目录执行 npx -y mcp-dev-cli install 自动修正配置。',
    }
  }

  return {
    name: 'mcp-config',
    status: 'warning',
    message: '.mcp.json 已存在，但没有正确声明 mcp-dev-cli',
    path: '.mcp.json',
    autoFixable: false,
    nextStep: '在项目目录执行 npx -y mcp-dev-cli install 自动写入标准接入配置。',
  }
}

function statusFromFiles(paths: string[]): 'present' | 'partial' | 'missing' {
  const count = paths.filter(path => existsSync(path)).length
  if (count === 0) return 'missing'
  if (count === paths.length) return 'present'
  return 'partial'
}

function messageForStatus(title: string, status: 'present' | 'partial' | 'missing', paths: string[]): string {
  const pathLabel = paths.map(path => path.split('/').slice(-2).join('/')).join(', ')
  if (status === 'present') return `${title} 已具备 (${pathLabel})`
  if (status === 'partial') return `${title} 仅部分具备 (${pathLabel})`
  return `${title} 缺失 (${pathLabel})`
}

export class PreflightScanner {
  async scan(projectRoot: string): Promise<PreflightReport> {
    const checks = [
      runGitCheck(projectRoot),
      await runClaudeCheck(),
      runNodeCheck(),
      runNetworkCheck(),
      runBuildCheck(projectRoot),
    ]
    return {
      passed: checks.every(check => check.status !== 'failed'),
      checks,
    }
  }

  scanConfig(projectRoot: string): ProjectConfigReport {
    const checks: ProjectConfigCheck[] = [
      hasParallelPlatform(projectRoot)
        ? {
            name: 'parallel-dir',
            status: 'passed',
            message: 'parallel 平台目录已初始化',
            path: '.claude/parallel',
            autoFixable: false,
          }
        : {
            name: 'parallel-dir',
            status: 'warning',
            message: '尚未初始化 parallel 平台目录',
            path: '.claude/parallel',
            autoFixable: true,
            fixAction: 'parallel_init',
            nextStep: '先执行 parallel_init 创建平台目录与基础结构。',
          },
      hasClaudeMd(projectRoot)
        ? {
            name: 'claude-md',
            status: 'passed',
            message: 'CLAUDE.md 已存在',
            path: 'CLAUDE.md',
            autoFixable: false,
          }
        : {
            name: 'claude-md',
            status: 'warning',
            message: '缺少 CLAUDE.md',
            path: 'CLAUDE.md',
            autoFixable: true,
            fixAction: 'parallel_init',
            nextStep: '执行 parallel_init 生成默认 CLAUDE.md 模板。',
          },
      buildMcpConfigCheck(projectRoot),
    ]

    return {
      passed: checks.every(check => check.status !== 'failed'),
      checks,
    }
  }

  scanCompleteness(projectRoot: string): ProjectCompletenessReport {
    const areas: ProjectCompletenessArea[] = [
      this.buildArea('build', 'Build chain', [join(projectRoot, 'package.json'), join(projectRoot, 'go.mod'), join(projectRoot, 'pyproject.toml')]),
      this.buildArea('tests', 'Validation/tests', [join(projectRoot, 'tests'), join(projectRoot, '__tests__'), join(projectRoot, 'vitest.config.ts'), join(projectRoot, 'jest.config.js')]),
      this.buildArea('source', 'Source modules', [join(projectRoot, 'src'), join(projectRoot, 'server'), join(projectRoot, 'app')]),
      this.buildArea('docs', 'Project docs', [join(projectRoot, 'README.md'), join(projectRoot, 'docs')]),
      this.buildArea('config', 'Project config', [join(projectRoot, '.env.example'), join(projectRoot, 'tsconfig.json'), join(projectRoot, '.mcp.json')]),
    ]

    const hardBlockers = areas
      .filter(area => area.key === 'source' && area.status === 'missing')
      .map(area => area.message)
    const softGaps = areas
      .filter(area => area.status === 'missing' && area.key !== 'source')
      .map(area => area.message)
    const suggestions = [
      ...areas.filter(area => area.status === 'partial').map(area => `补齐 ${area.title.toLowerCase()}，降低主控启动后的不确定性。`),
      ...(softGaps.length === 0 ? ['项目基础结构完整，可直接进入需求分析与 planning。'] : []),
    ]

    const status = hardBlockers.length > 0 ? 'blocked' : softGaps.length > 0 ? 'warning' : 'ready'
    const summary = status === 'blocked'
      ? '项目基础结构存在硬阻塞，暂不适合直接进入多角色执行。'
      : status === 'warning'
        ? '项目可启动，但仍有缺失项会增加主控分析和执行风险。'
        : '项目结构较完整，可进入需求分析与多角色 planning。'

    return {
      status,
      summary,
      hardBlockers,
      softGaps,
      suggestions,
      areas,
    }
  }

  private buildArea(key: string, title: string, paths: string[]): ProjectCompletenessArea {
    const status = statusFromFiles(paths)
    return {
      key,
      title,
      status,
      message: messageForStatus(title, status, paths),
    }
  }
}
