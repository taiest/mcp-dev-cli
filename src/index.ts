#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { initProject } from './tools/init.js'
import { startDev } from './tools/start.js'
import { resumeDev } from './tools/resume.js'
import { listRoles, addRole, removeRole } from './tools/roles.js'
import { getStatus } from './tools/status.js'
import { saveContext, loadContext, snapshotContext, restoreContext } from './tools/context.js'
import { findProjectRoot } from './utils/platform.js'

const server = new McpServer({
  name: 'mcp-dev-cli',
  version: '0.2.0',
})

server.tool(
  'mcp_dev_init',
  '初始化项目 MCP 协同开发配置（角色、断点目录、CLAUDE.md）。在任何 Git 项目中运行，自动检测技术栈并生成配置。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = await initProject(root)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_start',
  '输入开发需求，启动多角色并行协同开发。AI 自动拆分任务 → 创建 Git 分支 → 多 Claude 进程并行开发 → 自动合并 → 编译验证。支持文字描述，如果有截图可以先描述截图内容。',
  {
    requirement: z.string().describe('开发需求描述（支持详细的文字描述，包括 UI 设计说明、功能要求等）'),
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ requirement, projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = await startDev(requirement, root)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_resume',
  '恢复上次未完成的协同开发任务，从断点继续执行。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = await resumeDev(root)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_context_save',
  '保存当前项目分析上下文到 .claude/context 和本地缓存，供后续恢复与 resume 使用。',
  {
    goal: z.string().describe('当前任务目标'),
    constraints: z.array(z.string()).optional().describe('已确认约束'),
    analysis: z.string().optional().describe('需求/截图/现状分析摘要'),
    plan: z.string().optional().describe('当前实施计划摘要'),
    risks: z.array(z.string()).optional().describe('已知风险'),
    nextSteps: z.array(z.string()).optional().describe('下一步建议'),
    phase: z.string().optional().describe('当前阶段，如 planning / executing'),
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async (input) => {
    const result = saveContext(input)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_context_load',
  '读取当前项目的 context 或本地缓存，恢复最近一次分析上下文。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    preferLocalCache: z.boolean().optional().describe('优先从本地缓存恢复'),
  },
  async ({ projectRoot, preferLocalCache }) => {
    const result = loadContext(projectRoot, preferLocalCache)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_context_snapshot',
  '为当前项目上下文创建一个快照，便于 reload/重启后恢复。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    reason: z.string().optional().describe('快照原因，如 before-reload'),
  },
  async ({ projectRoot, reason }) => {
    const result = snapshotContext(projectRoot, reason)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_context_restore',
  '把最近一次项目上下文从 cache 恢复回 .claude/context。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
    preferLocalCache: z.boolean().optional().describe('优先从本地缓存恢复'),
  },
  async ({ projectRoot, preferLocalCache }) => {
    const result = restoreContext(projectRoot, preferLocalCache)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_roles_list',
  '查看当前项目配置的所有协同开发角色（名称、描述、模型、工具）。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = listRoles(root)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_roles_add',
  '新增一个自定义协同开发角色。',
  {
    name: z.string().describe('角色英文名称（小写+连字符，如 devops-skill）'),
    description: z.string().describe('角色职责描述'),
    model: z.string().optional().describe('使用的模型，默认 sonnet'),
    tools: z.string().optional().describe('工具列表，默认 Read,Write,Edit,Glob,Grep,Bash'),
    color: z.string().optional().describe('终端颜色标识'),
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ name, description, model, tools, color, projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = addRole(root, name, description, model, tools, color)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_roles_remove',
  '删除一个协同开发角色。',
  {
    name: z.string().describe('要删除的角色名称'),
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ name, projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = removeRole(root, name)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

server.tool(
  'mcp_dev_status',
  '查看当前协同开发任务的执行状态（进度、各子任务状态）。',
  {
    projectRoot: z.string().optional().describe('项目根目录路径，留空则自动检测'),
  },
  async ({ projectRoot }) => {
    const root = projectRoot || findProjectRoot()
    const result = getStatus(root)
    return { content: [{ type: 'text' as const, text: result }] }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
