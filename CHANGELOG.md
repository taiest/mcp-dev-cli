# Changelog

## v0.5.0 (2026-04-16)

### New Features
- 新增 `parallel_startup`，统一表达新建 / 继续 / 模板入口与结构化启动流
- 新增治理化 session 状态与 review / merge gate 展示
- 新增监控汇总、事件分类、task monitoring rows 与标准 report/export 字段
- 新增 Git 锁、merge/rebase/cherry-pick 中间态识别与 recovery action 分类
- 新增结构化 audit trail 持久化到 `.claude/parallel/audit.json`
- 新增 `ClaudeAdapter` / `ClaudeCliAdapter` 执行适配层边界

### Improvements
- dashboard 现在同时输出 monitoring、governance、recovery 与 audit trail
- resume 链路现在会保留并追加结构化审计记录
- README 与版本信息对齐当前真实能力，不再混淆未正式承诺的范围
- 新增跨平台 CI build matrix：Linux / macOS / Windows + Node 18 / 20

## v0.4.0 (2026-04-16)

### Breaking Changes
- 产品主入口统一为 `parallel_*` 工具面，旧工具面不再作为主表达
- 旧 orchestrator / worker / merger / git-manager / checkpoint / task-splitter / contract 模块降级为兼容层或 retired wrapper

### New Features
- `parallel_start` 已升级为真实依赖驱动的并行调度执行内核
- task graph 已按 requirement / stack 生成动态结构，而不是固定流水线
- stack / policy / contract gate 已进入主链路
- recovery 记录支持 retry / reassign / replan / resume suggestion
- `parallel_resume` 现在会真正继续执行 session，而不只是展示状态

### Improvements
- dashboard / report / resume 统一展示 merge 与 recovery 信息
- 对内对外产品表述统一为一个整体 parallel platform

## v0.3.1 (2026-04-15)

### Fixes
- 对齐 `package.json` 的 `bin` 字段为 npm 推荐格式：`dist/index.js`
- 消除 `npm publish` 时对 `bin[mcp-dev-cli]` 的自动修正 warning
- 保持仓库源码配置与已发布包元数据一致

## v0.3.0 (2026-04-15)

### New Features
- 新增项目级上下文连续性能力，支持分析摘要与恢复状态持久化
- 新增项目级缓存目录 `.claude/cache/`，支持 latest summary 与 snapshots
- 新增用户本地缓存目录 `~/.claude/mcp-dev-cli/cache/<project-hash>/`，在 Claude Code reload / 重启后继续恢复分析状态
- 启动前会自动加载已恢复上下文，并注入调度与执行主链
- 恢复链路会自动恢复分析上下文，并在执行输出中展示恢复摘要
- 状态查看现在会显示当前上下文恢复来源与可恢复状态
- 初始化现在会自动创建 `.claude/cache/` 和结构化上下文文件模板
- README 更新为更偏一键化、新手友好的接入与恢复流程

### Improvements
- 修复启动链路中恢复上下文重复注入任务拆分提示的问题
- 完成真实冒烟验证：project context / project cache / local cache / snapshot 回退恢复均可用
- 完成真实冒烟验证：start / resume 已确认会把恢复上下文注入执行链路

## v0.2.0 (2026-04-15)

### Breaking Changes
- 从 CLI 工具转为 MCP Server，不再支持终端交互式命令
- 移除 commander/inquirer/ora/chalk 依赖

### New Features
- 平台初版 MCP tools 已可在 Claude Code 中直接对话使用
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
