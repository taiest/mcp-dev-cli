# mcp-dev-cli

面向 Claude Code 的统一并行 MCP 开发助手。

它是一个整体工具，主路径应该是：**一条命令安装并接入 → `/mcp` 选择 `mcp-dev-cli` → `parallel_startup` → 输入需求 → 生成计划 → 审批 → 前台执行 → 输出总结。**

## 快速开始

在 Claude 里进入你的真实项目后，执行这一条命令：

```bash
npx -y mcp-dev-cli install "/absolute/project/path"
```

如果你已经在项目根目录，也可以直接执行：

```bash
npx -y mcp-dev-cli install
```

这条命令会自动完成：
- 检查 Claude Code CLI 是否可用
- 把 `mcp-dev-cli` 注册为当前项目的 MCP server
- 初始化 `.claude/*`、`CLAUDE.md`、`.mcp.json`
- 修正旧的错误 `.mcp.json` 模板
- 明确告诉你安装到了哪个项目路径

安装完成后：

1. 打开 Claude Code 并进入这个项目
2. 输入 `/mcp`
3. 选择 `mcp-dev-cli`
4. 运行 `parallel_startup`
5. 运行 `parallel_requirement` 输入本轮项目需求
6. 运行 `parallel_start`

## 标准使用流

### 1. 安装并接入

```bash
npx -y mcp-dev-cli install "/absolute/project/path"
```

如果当前 shell 已经在项目根目录，也支持：

```bash
npx -y mcp-dev-cli install
```

### 2. 在 Claude Code 里选择工具

```text
/mcp
```

然后选择：

```text
mcp-dev-cli
```

### 3. 查看当前项目 startup/controller 状态

对应工具：`parallel_startup`

它会告诉你：
- 当前项目是否已初始化
- 当前 MCP 接入是否正确
- 当前项目完整度、缺失项和阻塞项
- 已录入需求时，对应需求类型、可能落点、推荐角色、清晰度和风险
- 当前是否已录入需求
- 现在应该 `parallel_init`、`parallel_requirement`、`parallel_start`、`parallel_approve` 还是 `parallel_resume`

### 4. 输入需求，录入本轮项目目标

对应工具：`parallel_requirement`

这一步用于：
- 保存本轮明确需求
- 让 startup/controller 面板显示当前需求
- 让 startup/controller 面板提前展示需求类型、可能落点、推荐角色与风险提示
- 让 `parallel_start` 可以直接复用该需求进入 planning

### 5. 启动前补做 preflight 与完整度检查

对应工具：`parallel_preflight`

它会告诉你：
- Git、Claude、Node、网络、构建链路是否存在阻塞
- 当前项目完整度状态是 `ready`、`warning` 还是 `blocked`
- 哪些是 hard blockers、soft gaps、suggestions
- 下一步应该先修复、先补齐，还是可继续进入 `parallel_requirement` / `parallel_start`

### 6. 生成执行计划

对应工具：`parallel_start`

当前实现是审批前置：
- 先读取已录入需求，或直接接收 requirement 参数
- 先拆任务
- 先做 MCP 分配
- 先输出执行计划
- 不会直接后台开跑

### 7. 确认后执行

对应工具：`parallel_approve`

执行后会在当前终端进入主控执行流，展示：
- MCP lane 状态
- 任务进度
- 耗时
- token 消耗
- merge / validation 结果

### 8. 运行中查看状态

对应工具：`parallel_dashboard`

### 9. 中断后恢复

对应工具：`parallel_resume`

### 10. 最终导出结果

对应工具：`parallel_report`

## 安装命令的预期结果

执行：

```bash
npx -y mcp-dev-cli install "/absolute/project/path"
```

成功后你应该得到：
- 当前项目 `.mcp.json` 中只保留 `mcp-dev-cli`
- Claude Code 项目级 MCP 已注册 `mcp-dev-cli`
- 输出中明确显示安装目标项目路径
- 进入 Claude Code 后可以通过 `/mcp` 选择 `mcp-dev-cli`

## 故障排查

### `/mcp` 里没看到 `mcp-dev-cli`

先确认你是在**安装命令执行过的同一个项目目录**里打开 Claude Code。

然后重新执行：

```bash
npx -y mcp-dev-cli install "/absolute/project/path"
```

### `.mcp.json` 里还是旧的 filesystem 配置

直接重新执行：

```bash
npx -y mcp-dev-cli install "/absolute/project/path"
```

安装流程会自动修正为 `mcp-dev-cli` 的标准接入配置。

### Claude CLI 不存在

安装命令会直接失败并提示先安装 Claude Code CLI。

### `parallel_start` 提示 requirement missing

先执行：

```text
parallel_requirement
```

录入本轮项目需求后，再执行：

```text
parallel_start
```

### `parallel_preflight` 显示 blocked / warning

先按输出里的 hard blockers、soft gaps 和 next 建议处理。

如果需要重新生成基础结构，优先执行：

```text
parallel_init
```

如果只是补齐项目本身缺失项，处理后重新执行：

```text
parallel_preflight
```

## 工具一览

| 工具 | 什么时候用 |
|------|------------|
| `parallel_startup` | `/mcp` 连接成功后先看 startup/controller 状态 |
| `parallel_init` | 仓库尚未初始化并行平台时 |
| `parallel_requirement` | startup 后先录入本轮项目需求 |
| `parallel_preflight` | 启动前检查环境、配置、构建链路和项目完整度时 |
| `parallel_start` | 输入需求后先生成计划时 |
| `parallel_approve` | 审批通过后执行时 |
| `parallel_resume` | 中断后恢复时 |
| `parallel_dashboard` | 查看当前 MCP 分配、进度、阻塞时 |
| `parallel_report` | 查看本轮执行总结时 |

## 手动方式（仅用于诊断）

如果你要手工检查，也可以执行：

```bash
claude mcp add mcp-dev-cli --scope project -- npx -y mcp-dev-cli
```

但这不再是主路径。主路径始终应该是：

```bash
npx -y mcp-dev-cli install "/absolute/project/path"
```
