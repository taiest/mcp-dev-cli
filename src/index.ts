#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { initProjectApp } from './app/init-project.js'
import { startParallelSession } from './app/start-parallel-session.js'
import { resumeSession } from './app/resume-session.js'
import { getDashboard } from './app/get-dashboard.js'
import { exportParallelReport } from './app/export-report.js'
import { switchModel } from './app/switch-model.js'
import { addContract, listContracts } from './app/manage-contracts.js'
import { PreflightScanner } from './core/preflight/preflight-scanner.js'
import { SessionRuntime } from './core/runtime/session-runtime.js'
import { findProjectRoot } from './utils/platform.js'

const server = new McpServer({
  name: 'mcp-dev-cli',
  version: '0.5.0',
})

server.tool(
  'parallel_init',
  '初始化新一代多角色并行开发平台目录、角色模板与基础结构。',
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
  '查看标准化启动流状态，包含新建任务、历史继续、模板入口、配置校验与 preflight 建议。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = await new SessionRuntime(root).buildStartupFlow()
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'parallel_preflight',
  '执行并行开发前置扫描，检查 Git、Claude、Node、网络和构建能力。',
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
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
  }
)

server.tool(
  'parallel_start',
  '启动新一代多角色并行开发 session。',
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
  'parallel_resume',
  '恢复上次中断的 parallel session，保留进度、契约与模型状态。',
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
  '查看当前 parallel session 的 dashboard 视图。',
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
  '导出当前 parallel session 的执行统计报表。',
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
  '切换指定 MCP 节点模型，保持 session continuity。',
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
  '查看或新增 parallel session 的接口契约。',
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
