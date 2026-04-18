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
import { patchSession } from './app/patch-session.js'
import { manageContext } from './app/manage-context.js'
import { installAndConnect } from './app/install-and-connect.js'
import { PreflightScanner } from './core/preflight/preflight-scanner.js'
import { SessionRuntime } from './core/runtime/session-runtime.js'
import { renderPreflight, renderStartupFlow } from './core/terminal/renderers.js'
import { findInstallProjectRoot, findProjectRoot, resolveInstallProjectRoot } from './utils/platform.js'

async function runInstallCommand() {
  const explicitProjectPath = process.argv[3]
  const root = explicitProjectPath
    ? resolveInstallProjectRoot(explicitProjectPath)
    : findInstallProjectRoot()
  const result = await installAndConnect(root)
  process.stdout.write(`${result}\n`)
}

async function startMcpServer() {
  const server = new McpServer({
    name: 'mcp-dev-cli',
    version: '0.7.0',
  })

  server.tool(
    'parallel_init',
    '初始化项目的并行开发环境，创建必要的目录结构和配置文件。',
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
    '查看项目状态总览：环境检测、项目完整度、需求分析，以及推荐的下一步操作。',
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
    'parallel_requirement',
    '录入本轮项目需求，系统会自动分析需求类型、影响范围和推荐的团队配置。需求录入后必须调用 parallel_start 生成执行计划，不要自行开发。',
    {
      requirement: z.string().min(1).describe('本轮项目需求描述'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ requirement, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const runtime = new SessionRuntime(root)
      const draft = runtime.saveRequirementDraft(requirement.trim())
      const startup = await runtime.buildStartupFlow()
      return {
        content: [{
          type: 'text' as const,
          text: [
            '✅ requirement captured',
            `project: ${root}`,
            `captured at: ${draft.capturedAt}`,
            `requirement: ${draft.requirement}`,
            '',
            '⚠️ IMPORTANT: Do NOT start coding or implementing this requirement directly.',
            '⚠️ You MUST call parallel_start to split tasks, assign AI roles, and generate an execution plan.',
            '',
            renderStartupFlow(startup),
          ].join('\n'),
        }],
      }
    }
  )

  server.tool(
    'parallel_preflight',
    '检查开发环境是否就绪：Git、Node、构建工具、项目完整度，并给出修复建议。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const scanner = new PreflightScanner()
      const result = {
        config: scanner.scanConfig(root),
        preflight: await scanner.scan(root),
        completeness: scanner.scanCompleteness(root),
      }
      return { content: [{ type: 'text' as const, text: renderPreflight(result.config, result.preflight, result.completeness) }] }
    }
  )

  server.tool(
    'parallel_start',
    '根据需求自动拆解任务、分配多个 AI 角色并生成执行计划。注意：此工具只生成计划，不会创建角色或开始执行。计划生成后必须调用 parallel_approve 才能启动开发。',
    {
      requirement: z.string().optional().describe('开发需求描述；留空时优先使用 parallel_requirement 已记录的需求'),
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
    '确认执行计划后启动：创建各角色工作区，开始多角色并行开发，实时输出进度。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await approveSession(root, server.server)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_resume',
    '恢复中断的开发任务，从上次进度继续执行。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await resumeSession(root, server.server)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_dashboard',
    '查看当前开发进度：各角色状态、任务完成情况、阻塞项和下一步建议。',
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
    '查看本轮开发总结：完成情况、关键指标和后续建议。',
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
    '切换指定角色使用的 AI 模型，保持当前工作进度不丢失。',
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
    '查看或添加角色间的接口契约，确保多角色协作时接口一致。',
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

  server.tool(
    'parallel_patch',
    '在已完成的 session 上追加修改或修复任务。自动加载目标 MCP 的上下文缓存，派给原负责人继续执行。',
    {
      requirement: z.string().min(1).describe('修改/修复需求描述'),
      targetMcpId: z.string().optional().describe('指定派给哪个 MCP，留空则自动匹配原负责人'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ requirement, targetMcpId, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await patchSession(root, requirement, targetMcpId, server.server)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_context',
    '查看、检索或恢复上下文缓存。每个 MCP 的每个任务完成后都会自动保存上下文快照，带时间戳，不受重启影响。',
    {
      action: z.enum(['list', 'show', 'restore']).describe('操作类型：list 列出所有 / show 查看详情 / restore 按时间点恢复'),
      mcpId: z.string().optional().describe('MCP 编号，action=show 时必填'),
      taskId: z.string().optional().describe('任务编号，action=show 时必填'),
      timestamp: z.string().optional().describe('时间点，action=restore 时必填，格式如 "2025-01-15 14:32"'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ action, mcpId, taskId, timestamp, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = manageContext(root, action, mcpId, taskId, timestamp)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

async function runUninstallCommand() {
  const explicitProjectPath = process.argv[3]
  const root = explicitProjectPath
    ? resolveInstallProjectRoot(explicitProjectPath)
    : findInstallProjectRoot()
  const { uninstallProject } = await import('./app/uninstall.js')
  const result = await uninstallProject(root)
  process.stdout.write(`${result}\n`)
}

const command = process.argv[2]

if (command === 'install') {
  await runInstallCommand()
} else if (command === 'uninstall') {
  await runUninstallCommand()
} else {
  await startMcpServer()
}
