import type { PreflightCheckResult, PreflightReport, ProjectConfigCheck, ProjectConfigReport } from '../../types.js'
import { runGitCheck } from './checks/git-check.js'
import { runClaudeCheck } from './checks/claude-check.js'
import { runNodeCheck } from './checks/node-check.js'
import { runBuildCheck } from './checks/build-check.js'
import { hasClaudeMd, hasMcpConfig, hasParallelPlatform } from '../../utils/platform.js'

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
      hasMcpConfig(projectRoot)
        ? {
            name: 'mcp-config',
            status: 'passed',
            message: '.mcp.json 已存在',
            path: '.mcp.json',
            autoFixable: false,
          }
        : {
            name: 'mcp-config',
            status: 'warning',
            message: '缺少 .mcp.json，当前项目未声明 MCP server 接入',
            path: '.mcp.json',
            autoFixable: false,
            nextStep: '按 README 配置 .mcp.json，或使用 claude mcp add 完成项目级接入。',
          },
    ]

    return {
      passed: checks.every(check => check.status !== 'failed'),
      checks,
    }
  }
}
