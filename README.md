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

配置完成后，优先让 Claude Code 重新加载项目 MCP 配置；如果宿主暂不支持热加载，新开会话后也可以通过项目上下文和本地缓存自动恢复分析状态。

## 前置要求

- Node.js >= 18
- Git
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 已安装并登录

## 新手一键用法

推荐按下面最简流程使用：

### 1. 一键初始化
直接在 Claude Code 里说：

```text
帮我初始化当前项目的 mcp-dev-cli 协同开发配置
```

对应工具：`mcp_dev_init`

### 2. 一键保存当前分析
如果你已经在当前会话里完成了需求分析、截图分析、页面拆解，直接说：

```text
帮我保存当前项目上下文
```

对应工具：`mcp_dev_context_save`

它会自动把分析摘要写入：
- `.claude/context/`
- `.claude/cache/`
- 本机本地缓存目录

### 3. 一键恢复上下文
如果 Claude Code 重启、MCP reload 失败、或者你想继续上次的分析：

```text
帮我恢复当前项目上下文
```

对应工具：`mcp_dev_context_load`

### 4. 一键启动并行开发
```text
帮我开始开发这个需求
```

对应工具：`mcp_dev_start`

它会自动：
- 读取已保存的上下文
- 结合当前需求拆任务
- 创建分支
- 启动多角色并行开发
- 自动合并与编译验证

### 5. 一键继续上次任务
```text
继续上次的任务
```

对应工具：`mcp_dev_resume`

它会自动尝试恢复：
- checkpoint
- 分析上下文
- 本地缓存

整个目标就是：
- 尽量少手动步骤
- 尽量一键启动
- 新手也能直接用

## 怎么用

配置好之后，直接在 Claude Code 里说话就行：

```text
你: "帮我实现会员管理模块的 CRUD"
你: "参考这个截图，实现这个页面" (直接粘贴截图)
你: "查看一下当前有哪些角色"
你: "上次的任务还没做完，帮我继续"
```

Claude 会自动调用对应的工具完成操作。

## 可用工具

| 工具 | 说明 |
|------|------|
| `mcp_dev_init` | 初始化项目协同配置（角色、上下文目录、缓存目录、CLAUDE.md） |
| `mcp_dev_context_save` | 保存当前分析上下文到项目文件和本地缓存 |
| `mcp_dev_context_load` | 恢复当前项目最近一次分析上下文 |
| `mcp_dev_context_snapshot` | 为当前上下文创建缓存快照，便于 reload/重启后恢复 |
| `mcp_dev_context_restore` | 把最近一次可恢复上下文重新写回项目 `.claude/context` |
| `mcp_dev_start` | 输入需求，启动多角色并行开发 |
| `mcp_dev_resume` | 断点续跑，恢复未完成任务与分析上下文 |
| `mcp_dev_roles_list` | 查看角色列表 |
| `mcp_dev_roles_add` | 新增自定义角色 |
| `mcp_dev_roles_remove` | 删除角色 |
| `mcp_dev_status` | 查看任务执行状态和上下文恢复来源 |

## 上下文连续性

`mcp-dev-cli` 现在不只保存任务状态，也会保存分析上下文。

### 项目内持久化
项目里会创建：

```text
.claude/context/
.claude/cache/
```

其中：
- `.claude/context/` 保存结构化分析内容
- `.claude/cache/` 保存最近一次上下文快照

### 本地缓存
同时也会写入用户本地缓存：

```text
~/.claude/mcp-dev-cli/cache/<project-hash>/
```

这样即使 Claude Code 重启，也能恢复最近一次分析摘要。

### 恢复顺序
工具恢复时会按以下顺序查找：
1. `.claude/context/*`
2. `.claude/cache/latest-summary.json`
3. `~/.claude/mcp-dev-cli/cache/<project-hash>/latest-context.json`
4. 最近 snapshot

## 工作流程

```text
对话输入需求（文字/截图/混合）
    ↓
必要时保存当前分析上下文
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

任务状态自动保存到 `.claude/context/task-checkpoint.json`。

分析上下文会自动保存到：
- `.claude/context/`
- `.claude/cache/`
- 本地缓存目录

中断后直接说：

```text
继续上次的任务
```

即可恢复。

## 发布要求

正式交付时应同时完成：
- GitHub 代码推送
- npm 版本发布

确保新手用户可以直接通过：

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

一键接入。

## License

MIT
