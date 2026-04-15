# Changelog

## v0.3.0 (2026-04-15)

### New Features
- 新增 4 个上下文连续性工具：`mcp_dev_context_save` / `mcp_dev_context_load` / `mcp_dev_context_snapshot` / `mcp_dev_context_restore`
- 新增项目级缓存目录 `.claude/cache/`，支持 latest summary 与 snapshots
- 新增用户本地缓存目录 `~/.claude/mcp-dev-cli/cache/<project-hash>/`，在 Claude Code reload / 重启后继续恢复分析状态
- `mcp_dev_start` 启动前会自动加载已恢复上下文，并注入任务拆分与 worker 执行提示词
- `mcp_dev_resume` 续跑前会自动恢复分析上下文，并在执行输出中展示恢复摘要
- `mcp_dev_status` 现在会显示当前上下文恢复来源与可恢复状态
- `mcp_dev_init` 现在会自动创建 `.claude/cache/` 和 6 个结构化上下文文件模板
- README 更新为更偏一键化、新手友好的接入与恢复流程

### Improvements
- 修复 `start` 链路中恢复上下文重复注入 task splitter prompt 的问题
- 完成真实冒烟验证：project context / project cache / local cache / snapshot 回退恢复均可用
- 完成真实冒烟验证：`start` / `resume` 已确认会把恢复上下文注入 orchestration 链路

## v0.2.0 (2026-04-15)

### Breaking Changes
- 从 CLI 工具转为 MCP Server，不再支持终端交互式命令
- 移除 commander/inquirer/ora/chalk 依赖

### New Features
- 7 个 MCP tools：mcp_dev_init / mcp_dev_start / mcp_dev_resume / mcp_dev_roles_list / mcp_dev_roles_add / mcp_dev_roles_remove / mcp_dev_status
- 在 Claude Code 中直接对话使用，零命令学习成本
- 天然支持截图+文字混合需求（Claude Code 原生图片能力）
- 自动检测未初始化项目并自动 init
- 基于 @modelcontextprotocol/sdk 标准协议

### How to Use
在项目 `.mcp.json` 中添加配置即可：
```json
{
  "mcpServers": {
    "mcp-dev-cli": {
      "command": "npx",
      "args": ["-y", "mcp-dev-cli"]
    }
  }
}
```

## v0.1.0 (2026-04-15)
- 初始版本：CLI 交互式工具
- 支持 init/start/resume/roles/status 命令
- 5 个内置角色模板（lead-router/frontend/backend/test/pm）
- Git 分支隔离 + 自动合并
- 断点续跑
