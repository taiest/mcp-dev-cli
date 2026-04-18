#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { initProjectApp } from './app/init-project.js'
import { startParallelSession } from './app/start-parallel-session.js'
import { approveSession } from './app/approve-session.js'
import { resumeSession } from './app/resume-session.js'
import { getDashboard } from './app/get-dashboard.js'
import { exportParallelReport } from './app/export-report.js'
import { switchModel } from './app/switch-model.js'
import { addContract, listContracts } from './app/manage-contracts.js'
import { installAndConnect } from './app/install-and-connect.js'
import { PreflightScanner } from './core/preflight/preflight-scanner.js'
import { SessionRuntime } from './core/runtime/session-runtime.js'
import { renderPreflight, renderStartupFlow } from './core/terminal/renderers.js'
import { findProjectRoot } from './utils/platform.js'

async function runInstallCommand() {
  const root = findProjectRoot()
  const result = await installAndConnect(root)
  process.stdout.write(`${result}\n`)
}

async function startMcpServer() {
  const server = new McpServer({
    name: 'mcp-dev-cli',
    version: '0.5.1',
  })

  server.tool(
    'parallel_init',
    '在 startup 判断需要初始化时使用，创建当前仓库的并行协作目录、角色模板与基础结构。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await initProjectApp(root)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_startup',
    '通过 /mcp 连接工具后优先使用：显示当前连接状态、项目是否可开始开发，以及下一步该 init、start、approve 还是 resume。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await new SessionRuntime(root).buildStartupFlow()
      return { content: [{ type: 'text' as const, text: renderStartupFlow(result) }] }
    }
  )

  server.tool(
    'parallel_preflight',
    '在启动前使用，检查 Git、Claude、Node、网络和构建链路是否阻塞并行 session。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const scanner = new PreflightScanner()
      const result = {
        config: scanner.scanConfig(root),
        preflight: await scanner.scan(root),
      }
      return { content: [{ type: 'text' as const, text: renderPreflight(result.config, result.preflight) }] }
    }
  )

  server.tool(
    'parallel_start',
    '在输入需求后使用：先生成需求拆解、任务分配与执行计划，等待用户审批，不会立即执行。',
    {
      requirement: z.string().describe('开发需求描述'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
      mcpCount: z.number().int().min(1).max(12).optional().describe('MCP 节点数量，默认 6'),
    },
    async ({ requirement, projectRoot, mcpCount }) => {
      const root = projectRoot || findProjectRoot()
      const result = await startParallelSession(requirement, root, mcpCount || 6)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_approve',
    '在执行计划确认后使用：创建角色与工作区，进入前台主控执行，并返回实时控制摘要与最终结果。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await approveSession(root)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_resume',
    '在存在中断 session 时使用，恢复当前进度、继续前台执行，并告诉你还剩什么工作。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await resumeSession(root)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_dashboard',
    '查看多 MCP 主控界面：显示当前分配、角色、进度、阻塞、审批状态和建议下一步。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await getDashboard(root)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_report',
    '在需要回顾本轮结果时使用，输出当前 session 的执行总结、关键指标和后续建议。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await exportParallelReport(root)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_model_switch',
    '在运行中需要切换指定 MCP 节点模型时使用，并尽量保持当前 session 上下文连续。',
    {
      mcpId: z.string().describe('MCP 编号，如 MCP-03'),
      model: z.string().describe('目标模型名称'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ mcpId, model, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await switchModel(root, mcpId, model)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_contracts',
    '在需要查看或补充 session 契约时使用，管理并行执行中的接口/交付契约。',
    {
      action: z.enum(['list', 'add']).describe('契约操作'),
      name: z.string().optional().describe('契约名称，action=add 时必填'),
      content: z.string().optional().describe('契约内容，action=add 时必填'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ action, name, content, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = action === 'add'
        ? await addContract(root, name || 'unnamed-contract', content || '')
        : await listContracts(root)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

const command = process.argv[2]

if (command === 'install') {
  await runInstallCommand()
} else {
  await startMcpServer()
}
