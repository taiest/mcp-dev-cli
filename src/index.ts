#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { initProjectApp } from './app/init-project.js'
import { startParallelSession } from './app/start-parallel-session.js'
import { approveSession } from './app/approve-session.js'
import { resumeSession } from './app/resume-session.js'
import { getNextBatch, renderNextBatch } from './app/next-batch.js'
import { reportTaskDone } from './app/task-done.js'
import { finalizeSession } from './app/finalize-session.js'
import { getDashboard } from './app/get-dashboard.js'
import { exportParallelReport } from './app/export-report.js'
import { switchModel } from './app/switch-model.js'
import { addContract, listContracts } from './app/manage-contracts.js'
import { patchSession } from './app/patch-session.js'
import { manageContext } from './app/manage-context.js'
import { installAndConnect } from './app/install-and-connect.js'
import { PreflightScanner } from './core/preflight/preflight-scanner.js'
import { SessionRuntime } from './core/runtime/session-runtime.js'
import { renderPreflight, renderStartupFlow, renderMcpMessages } from './core/terminal/renderers.js'
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
    version: '1.0.1',
  })

  server.tool(
    'parallel_init',
    '【初始化】初始化项目的并行开发环境，创建必要的目录结构和配置文件。',
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
    '【状态总览】查看项目状态总览：环境检测、项目完整度、需求分析，以及推荐的下一步操作。',
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
    '【录入需求】录入本轮项目需求，系统会自动分析需求类型、影响范围和推荐的团队配置。需求录入后必须调用 parallel_start 生成执行计划，不要自行开发。',
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
    '【环境检查】检查开发环境是否就绪：Git、Node、构建工具、项目完整度，并给出修复建议。',
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
    '【生成计划】根据需求自动拆解任务、由 MCP-01 按工作量动态决定多个 AI 角色数量并生成执行计划。注意：此工具只生成计划，不会创建角色或开始执行。计划生成后必须调用 parallel_approve 才能启动开发。',
    {
      requirement: z.string().optional().describe('开发需求描述；留空时优先使用 parallel_requirement 已记录的需求'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
      mcpCount: z.number().int().min(1).max(12).optional().describe('可选 MCP 总数上限；留空时由 MCP-01 根据工作量动态决定'),
    },
    async ({ requirement, projectRoot, mcpCount }) => {
      const root = projectRoot || findProjectRoot()
      const result = await startParallelSession(requirement, root, mcpCount)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_approve',
    '【确认执行】确认执行计划后启动：创建各角色工作区，准备并行开发环境。完成后请调用 parallel_next_batch 获取可执行任务。',
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
    '【恢复任务】恢复中断的开发任务。完成后请调用 parallel_next_batch 获取可执行任务。',
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
    'parallel_next_batch',
    '【获取任务批次】获取下一批可并行执行的任务。返回适合 Claude Code 前端直接启动 Agent() 的任务元信息、展示文本和原始 JSON。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await getNextBatch(root)
      return { content: [{ type: 'text' as const, text: renderNextBatch(result) }] }
    }
  )

  server.tool(
    'parallel_task_done',
    '【回报任务完成】Agent 执行完成后调用此工具回报结果。系统会自动解锁依赖任务。',
    {
      taskId: z.string().min(1).describe('任务 ID，如 task-1'),
      mcpId: z.string().min(1).describe('执行该任务的 MCP 角色 ID，如 MCP-02'),
      success: z.boolean().describe('任务是否成功完成'),
      output: z.string().describe('Agent 的执行输出摘要'),
      durationMs: z.number().optional().describe('执行耗时（毫秒）'),
      totalTokens: z.number().optional().describe('消耗的 token 数'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ taskId, mcpId, success, output, durationMs, totalTokens, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await reportTaskDone(root, { taskId, mcpId, success, output, durationMs, totalTokens })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.tool(
    'parallel_finalize',
    '【完成合并】所有任务完成后调用。执行代码合并、质量门检查、生成最终报告。',
    {
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await finalizeSession(root)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_dashboard',
    '【查看进度】查看当前开发进度：各角色状态、任务完成情况、阻塞项和下一步建议。',
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
    '【查看报告】查看本轮开发总结：完成情况、关键指标和后续建议。',
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
    '【切换模型】切换指定角色使用的 AI 模型，保持当前工作进度不丢失。',
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
    '【接口契约】查看或添加角色间的接口契约，确保多角色协作时接口一致。',
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
    '【追加修改】在已完成的 session 上追加修改或修复任务。自动加载目标 MCP 的上下文缓存，派给原负责人继续执行。',
    {
      requirement: z.string().min(1).describe('修改/修复需求描述'),
      targetMcpId: z.string().optional().describe('指定派给哪个 MCP，留空则自动匹配原负责人'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ requirement, targetMcpId, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const result = await patchSession(root, requirement, targetMcpId)
      return { content: [{ type: 'text' as const, text: result }] }
    }
  )

  server.tool(
    'parallel_context',
    '【上下文缓存】查看、检索或恢复上下文缓存。每个 MCP 的每个任务完成后都会自动保存上下文快照，带时间戳，不受重启影响。',
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

  server.tool(
    'parallel_messages',
    '【对话记录】查看指定 MCP 角色的完整对话记录。显示谁给它发了什么任务、它怎么回复的、执行结果等，按时间排序。',
    {
      mcpId: z.string().min(1).describe('要查看的 MCP 编号，如 "MCP-02"'),
      projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    },
    async ({ mcpId, projectRoot }) => {
      const root = projectRoot || findProjectRoot()
      const session = new SessionRuntime(root).load()
      if (!session) {
        return { content: [{ type: 'text' as const, text: '当前没有活跃的 session，无法查看对话记录。' }] }
      }
      return { content: [{ type: 'text' as const, text: renderMcpMessages(mcpId, session.messageLog || []) }] }
    }
  )

  server.tool(
    'parallel_help',
    '【帮助】查看所有可用工具的中英文对照表和标准使用流程。',
    {},
    async () => {
      const help = [
        '┌─────────────────────────────────────────────────────────┐',
        '│              mcp-dev-cli 工具对照表                     │',
        '├──────────┬──────────────────────┬───────────────────────┤',
        '│ 中文名   │ 工具 ID              │ 说明                  │',
        '├──────────┼──────────────────────┼───────────────────────┤',
        '│ 帮助     │ parallel_help        │ 查看本帮助页面        │',
        '│ 初始化   │ parallel_init        │ 初始化并行开发环境    │',
        '│ 状态总览 │ parallel_startup     │ 查看项目状态和建议    │',
        '│ 录入需求 │ parallel_requirement │ 录入本轮开发需求      │',
        '│ 环境检查 │ parallel_preflight   │ 检查 Git/Node 等环境  │',
        '│ 生成计划 │ parallel_start       │ 拆任务、分角色、出计划│',
        '│ 确认执行 │ parallel_approve     │ 审批计划并准备环境    │',
        '│ 获取任务 │ parallel_next_batch  │ 获取前端 Agent 批次   │',
        '│ 回报完成 │ parallel_task_done   │ Agent 完成后回报结果  │',
        '│ 完成合并 │ parallel_finalize    │ 合并代码并生成报告    │',
        '│ 恢复任务 │ parallel_resume      │ 恢复中断的开发任务    │',
        '│ 查看进度 │ parallel_dashboard   │ 查看各角色和任务状态  │',
        '│ 查看报告 │ parallel_report      │ 查看本轮开发总结      │',
        '│ 切换模型 │ parallel_model_switch│ 切换某角色的 AI 模型  │',
        '│ 接口契约 │ parallel_contracts   │ 管理角色间接口契约    │',
        '│ 追加修改 │ parallel_patch       │ 对已完成 session 追加 │',
        '│ 上下文   │ parallel_context     │ 查看/恢复上下文快照   │',
        '│ 对话记录 │ parallel_messages    │ 查看某 MCP 的对话记录 │',
        '└──────────┴──────────────────────┴───────────────────────┘',
        '',
        '标准流程：',
        '  初始化 → 状态总览 → 录入需求 → 生成计划 → 确认执行 → 获取任务 → Agent前端并行 → 回报完成 → 完成合并 → 查看报告',
        '',
        '你可以直接用中文名称描述你想做的事，系统会自动匹配对应工具。',
        '例如："帮我初始化"、"录入需求：添加用户登录功能"、"查看进度"',
      ].join('\n')
      return { content: [{ type: 'text' as const, text: help }] }
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

if (command === '--version' || command === '-v') {
  const { readFileSync } = await import('fs')
  const { fileURLToPath } = await import('url')
  const { dirname, join } = await import('path')
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8'))
  process.stdout.write(`${pkg.version}\n`)
} else if (command === 'install') {
  await runInstallCommand()
} else if (command === 'uninstall') {
  await runUninstallCommand()
} else {
  await startMcpServer()
}
