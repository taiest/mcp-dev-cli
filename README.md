# mcp-dev-cli

多 MCP 并行协同开发 CLI 工具。输入一个需求，AI 自动拆分子任务，多个 Claude 进程并行开发，Git 分支隔离，自动合并编译交付。

## 安装

```bash
npm install -g mcp-dev-cli
# 或直接使用
npx mcp-dev-cli
```

## 前置要求

- Node.js >= 18
- Git
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装并登录

## 快速开始

```bash
# 1. 在项目中初始化
cd your-project
npx mcp-dev-cli init

# 2. 输入需求，启动协同开发
npx mcp-dev-cli start "实现用户管理模块的 CRUD"

# 3. 如果中断了，断点续跑
npx mcp-dev-cli resume
```

## 命令

| 命令 | 说明 |
|------|------|
| `mcp-dev-cli` | 交互式菜单 |
| `mcp-dev-cli init` | 初始化项目 MCP 协同配置 |
| `mcp-dev-cli start <需求>` | 输入需求，启动协同开发 |
| `mcp-dev-cli resume` | 断点续跑 |
| `mcp-dev-cli roles` | 查看角色列表 |
| `mcp-dev-cli roles add` | 新增自定义角色 |
| `mcp-dev-cli roles remove` | 删除角色 |
| `mcp-dev-cli status` | 查看当前任务状态 |

## 工作流程

```
输入需求 → AI 拆分子任务 → 用户确认
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

支持自定义角色：`mcp-dev-cli roles add`

## 断点续跑

任务状态自动保存到 `.claude/context/task-checkpoint.json`。终端关闭后 `mcp-dev-cli resume` 自动恢复未完成的任务。

## 模型切换

切换 Claude 模型不影响任务进度，checkpoint 自动同步。

## License

MIT
