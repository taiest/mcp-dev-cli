# mcp-dev-cli

面向 Claude Code 的统一并行 MCP 开发助手。

它是一个整体工具，主路径应该是：**一条命令安装并接入 → `/mcp` 选择 `mcp-dev-cli` → `parallel_startup` → 输入需求 → 生成计划 → 审批 → 前台执行 → 输出总结。**

## 快速开始

在项目目录执行这一条命令：

```bash
npx -y mcp-dev-cli install
```

这条命令会自动完成：
- 检查 Claude Code CLI 是否可用
- 把 `mcp-dev-cli` 注册为当前项目的 MCP server
- 初始化 `.claude/*`、`CLAUDE.md`、`.mcp.json`
- 修正旧的错误 `.mcp.json` 模板

安装完成后：

1. 打开 Claude Code 并进入这个项目
2. 输入 `/mcp`
3. 选择 `mcp-dev-cli`
4. 运行 `parallel_startup`

## 标准使用流

### 1. 安装并接入

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

### 3. 查看当前项目 readiness

对应工具：`parallel_startup`

它会告诉你：
- 当前项目是否已初始化
- 当前 MCP 接入是否正确
- 现在应该 `parallel_init`、`parallel_start`、`parallel_approve` 还是 `parallel_resume`

### 4. 输入需求，先生成执行计划

对应工具：`parallel_start`

当前实现是审批前置：
- 先拆任务
- 先做 MCP 分配
- 先输出执行计划
- 不会直接后台开跑

### 5. 确认后执行

对应工具：`parallel_approve`

执行后会在当前终端进入主控执行流，展示：
- MCP lane 状态
- 任务进度
- 耗时
- token 消耗
- merge / validation 结果

### 6. 运行中查看状态

对应工具：`parallel_dashboard`

### 7. 中断后恢复

对应工具：`parallel_resume`

### 8. 最终导出结果

对应工具：`parallel_report`

## 安装命令的预期结果

执行：

```bash
npx -y mcp-dev-cli install
```

成功后你应该得到：
- 当前项目 `.mcp.json` 中只保留 `mcp-dev-cli`
- Claude Code 项目级 MCP 已注册 `mcp-dev-cli`
- 进入 Claude Code 后可以通过 `/mcp` 选择 `mcp-dev-cli`

## 故障排查

### `/mcp` 里没看到 `mcp-dev-cli`

先确认你是在**安装命令执行过的同一个项目目录**里打开 Claude Code。

然后重新执行：

```bash
npx -y mcp-dev-cli install
```

### `.mcp.json` 里还是旧的 filesystem 配置

直接重新执行：

```bash
npx -y mcp-dev-cli install
```

安装流程会自动修正为 `mcp-dev-cli` 的标准接入配置。

### Claude CLI 不存在

安装命令会直接失败并提示先安装 Claude Code CLI。

## 工具一览

| 工具 | 什么时候用 |
|------|------------|
| `parallel_startup` | `/mcp` 连接成功后先看 readiness |
| `parallel_init` | 仓库尚未初始化并行平台时 |
| `parallel_preflight` | 启动前检查环境、配置、构建链路时 |
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
npx -y mcp-dev-cli install
```
