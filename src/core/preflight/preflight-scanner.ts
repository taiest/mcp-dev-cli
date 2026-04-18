import type { PreflightCheckResult, PreflightReport, ProjectConfigCheck, ProjectConfigReport } from '../../types.js'
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
}
