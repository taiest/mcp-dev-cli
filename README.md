# mcp-dev-cli

统一的 Claude Code `parallel_*` MCP 平台。

它不是旧的分散式工具集合，而是一个整体产品：标准化启动流、治理化并行执行、恢复与回滚、结构化审计、dashboard 与 report。

## 当前已实现

- 标准化启动流：`parallel_startup`
- 项目初始化：`parallel_init`
- 结构化 preflight：`parallel_preflight`
- 多角色并行 session：`parallel_start`
- 中断后继续执行：`parallel_resume`
- dashboard 视图：`parallel_dashboard`
- 标准报告导出：`parallel_report`
- 模型切换 continuity：`parallel_model_switch`
- 契约查看/新增：`parallel_contracts`
- governance / review / quality / merge gate
- Git 锁与 merge/rebase/cherry-pick 中间态识别
- recovery / rollback 建议与审计链落盘

## 当前未承诺

以下能力目前**没有在 README 中承诺为已完成**：
- 图形化 GUI/独立桌面界面
- 自动发布到 GitHub 或 npm
- 完整集成测试套件
- 超出 Claude Code 之外的 IDE host adapter 正式支持

当前代码已经为 host adapter 留出接口缝，但正式支持范围仍以 Claude Code + MCP server 为主。

## 安装

在项目根目录添加 `.mcp.json`：

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

或执行：

```bash
claude mcp add mcp-dev-cli --scope project -- npx -y mcp-dev-cli
```

## 推荐使用流程

### 1. 查看启动流

```text
帮我查看当前项目的 parallel startup
```

对应工具：`parallel_startup`

### 2. 初始化

```text
帮我初始化当前项目的 parallel 平台
```

对应工具：`parallel_init`

### 3. 预检

```text
帮我做一次 parallel preflight
```

对应工具：`parallel_preflight`

### 4. 启动并行开发

```text
帮我启动这个需求的 parallel session
```

对应工具：`parallel_start`

### 5. 查看 dashboard

```text
帮我查看当前 parallel dashboard
```

对应工具：`parallel_dashboard`

### 6. 中断后继续

```text
继续当前 parallel session
```

对应工具：`parallel_resume`

### 7. 导出报告

```text
导出当前 parallel report
```

对应工具：`parallel_report`

## 工具面

| 工具 | 说明 |
|------|------|
| `parallel_startup` | 查看新建 / 继续 / 模板入口与结构化启动状态 |
| `parallel_init` | 初始化平台目录、角色模板与基础结构 |
| `parallel_preflight` | 执行 config + Git / Claude / Node / 网络 / 构建预检 |
| `parallel_start` | 启动新 session |
| `parallel_resume` | 恢复并继续推进未完成 session |
| `parallel_dashboard` | 查看 session dashboard |
| `parallel_report` | 导出执行报告 |
| `parallel_model_switch` | 切换指定 MCP 节点模型 |
| `parallel_contracts` | 查看或新增 session 契约 |

## 平台能力边界

当前仓库对内对外统一表达为一个整体平台：
- 单一 session runtime
- 单一 scheduler / governance / recovery / merge 主链
- 单一 dashboard / report / audit 视图
- 单一 `parallel_*` MCP 工具面

旧工具面与兼容层模块已降级，不再代表主流程。

## 兼容范围

- Claude Code：MCP server 方式接入
- Node.js：18+
- Git：需要标准 Git CLI 可用
- CI 验证矩阵：macOS / Windows / Linux + Node 18 / 20

## 开发

```bash
npm install
npm run build
```

## 发布纪律

发布前应至少完成：
- `npm run build`
- GitHub Actions CI 通过
- README 与 CHANGELOG 内容与当前实现一致
- MCP server version 与 `package.json` version 一致

## License

MIT
