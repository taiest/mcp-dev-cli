# mcp-dev-cli

MCP Server — 多角色并行协同开发工具。在 Claude Code 中直接对话，AI 自动拆分子任务，多个 Claude 进程并行开发，Git 分支隔离，自动合并编译交付。

## 一步配置

在你的项目根目录创建或编辑 `.mcp.json`：

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

或者用命令添加：

```bash
claude mcp add mcp-dev-cli --scope project -- npx -y mcp-dev-cli
```

配置完成后，重启 Claude Code，就可以直接对话使用了。

## 前置要求

- Node.js >= 18
- Git
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 已安装并登录

## 怎么用

配置好之后，直接在 Claude Code 里说话就行：

```
你: "帮我实现会员管理模块的 CRUD"
你: "参考这个截图，实现这个页面" (直接粘贴截图)
你: "查看一下当前有哪些角色"
你: "上次的任务还没做完，帮我继续"
```

Claude 会自动调用对应的工具完成操作。

## 可用工具

| 工具 | 说明 |
|------|------|
| `mcp_dev_init` | 初始化项目协同配置（角色、断点目录、CLAUDE.md） |
| `mcp_dev_start` | 输入需求，启动多角色并行开发 |
| `mcp_dev_resume` | 断点续跑，恢复未完成的任务 |
| `mcp_dev_roles_list` | 查看角色列表 |
| `mcp_dev_roles_add` | 新增自定义角色 |
| `mcp_dev_roles_remove` | 删除角色 |
| `mcp_dev_status` | 查看任务执行状态 |

## 工作流程

```
对话输入需求（文字/截图/混合）
    ↓
AI 自动拆分子任务 + 分配角色
    ↓
为每个子任务创建 Git 分支 (mcp/<role>-<id>)
    ↓
多个 Claude 进程并行开发（各自在独立分支）
    ↓
按依赖顺序自动合并 → 冲突时 AI 自动解决
    ↓
编译验证 (go build / tsc / npm test)
    ↓
输出交付报告
```

## 内置角色

| 角色 | 职责 |
|------|------|
| lead-router | 主控协调，任务分发 |
| frontend-skill | 前端开发 |
| backend-skill | 后端开发 |
| test-skill | 测试编写 |
| pm-agent | 需求分析 |

支持自定义角色，在 Claude Code 中说："帮我新增一个 devops-skill 角色"。

## 从 GitHub 安装（可选）

如果不想用 npx，也可以克隆仓库：

```bash
git clone https://github.com/taiest/mcp-dev-cli.git
cd mcp-dev-cli
npm install
npm run build
```

然后在项目 `.mcp.json` 中配置：

```json
{
  "mcpServers": {
    "mcp-dev-cli": {
      "command": "node",
      "args": ["/你的路径/mcp-dev-cli/dist/index.js"]
    }
  }
}
```

## 断点续跑

任务状态自动保存到 `.claude/context/task-checkpoint.json`。中断后说"继续上次的任务"即可恢复。

## License

MIT
