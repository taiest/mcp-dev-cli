# Changelog

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
