# mcp-dev-cli 可见性 + 追加任务 + 持久化上下文缓存

## 设计原则

1. 所有输出用 cli-table3 + Unicode box-drawing 结构化排版
2. 上下文缓存持久化磁盘，带时间戳，不受重启影响，可按时间点恢复
3. 每个 MCP 的耗时、tokens 全程统计，最终合并汇总表

## 新增依赖

- `cli-table3` — Unicode 表格渲染

---

## 一、实时进度推送 + 结构化统计表

### 实时推送（执行中）

用 `server.sendLoggingMessage()` 在 MCP 工具执行期间推送：

```
[mcp-dev-cli] ┌─ Batch #1 ─────────────────────────────────────────────────┐
[mcp-dev-cli] │  🚀 dispatching 3 tasks                                   │
[mcp-dev-cli] │  mcp-02  backend   → task-1: Create sales order model     │
[mcp-dev-cli] │  mcp-03  frontend  → task-2: Refactor OrdersReport tabs   │
[mcp-dev-cli] │  mcp-04  backend   → task-3: Build handler and service    │
[mcp-dev-cli] └────────────────────────────────────────────────────────────┘
[mcp-dev-cli] ✅ mcp-02 [backend]  task-1 done │ 38s │ 12,400 tokens
[mcp-dev-cli] ✅ mcp-04 [backend]  task-3 done │ 52s │ 14,620 tokens
[mcp-dev-cli] ✅ mcp-03 [frontend] task-2 done │ 1m 07s │ 21,300 tokens
[mcp-dev-cli] 🔀 Merging 3 branches → main...
[mcp-dev-cli] ✅ Merge completed
```

过滤规则 — 只推送关键节点：
- batch: dispatching（含任务分配表）/ completed
- task: started / completed / failed（含耗时+tokens）
- merge/recovery: 所有
- worker: 跳过（太频繁）

### 最终统计表（执行完成后返回）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Parallel Execution Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  session    session-1719000000000
  duration   2m 18s
  tokens     48,320
  tasks      3/3 completed

┌──────────┬───────────┬──────────────────────────────────┬──────────┬───────────┬──────────┐
│ MCP      │ Role      │ Task                             │ Status   │ Duration  │ Tokens   │
├──────────┼───────────┼──────────────────────────────────┼──────────┼───────────┼──────────┤
│ mcp-02   │ backend   │ Create sales order model         │ ✅ done  │ 38s       │ 12,400   │
│ mcp-03   │ frontend  │ Refactor OrdersReport tabs       │ ✅ done  │ 1m 07s    │ 21,300   │
│ mcp-04   │ backend   │ Build handler and service        │ ✅ done  │ 52s       │ 14,620   │
├──────────┼───────────┼──────────────────────────────────┼──────────┼───────────┼──────────┤
│ TOTAL    │           │ 3 tasks                          │ 3/3 ✅   │ 2m 18s    │ 48,320   │
└──────────┴───────────┴──────────────────────────────────┴──────────┴───────────┴──────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  🔀 Merge Result                                                                   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  ✅ 3 branches merged into main                                                    │
│  merged: parallel/mcp-02, parallel/mcp-03, parallel/mcp-04                          │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  📦 Context Cache                                                                  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  3 snapshots saved to .claude/parallel/context/                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  🚀 Next Steps                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  parallel_report    查看完整执行报告                                                │
│  parallel_patch     追加修改或修复 bug                                               │
│  parallel_context   查看/恢复上下文缓存                                             │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/index.ts` | parallel_approve/resume 传 `server.server` |
| `src/app/approve-session.ts` | 接收 server，传给 foreground |
| `src/app/resume-session.ts` | 同上 |
| `src/app/foreground-execution.ts` | onProgress 实时推送 + shouldBroadcast 过滤 |
| `src/core/terminal/renderers.ts` | 新增 renderExecutionSummaryTable（用 cli-table3） |

---

## 二、parallel_patch — 追加任务/返工

### 工具签名

```
parallel_patch(requirement, targetMcpId?, projectRoot?)
```

### 逻辑

1. 加载已完成 session，phase 改回 running
2. 生成 patch task（id 从现有最大 +1），追加到 taskGraph
3. 自动匹配原 MCP（按 targetMcpId 或按需求关联的文件匹配）
4. 加载目标 MCP 的上下文缓存，注入 worker prompt
5. 执行 → 写入新上下文快照 → 输出统计表

### 输出排版

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔧  Parallel Patch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  session    session-1719000000000 (reopened)
  patch      Fix sales order model validation bug
  target     mcp-02 [backend] ← original owner of task-1
  new task   task-4 (appended to task graph)

┌─────┬────────────────┬──────────────────┬──────────────────────────────┬───────────────────┐
│ #   │ MCP / Task     │ Time             │ Title                        │ Files             │
├─────┼────────────────┼──────────────────┼──────────────────────────────┼───────────────────┤
│ 1   │ mcp-02/task-1  │ 01-15 14:32:08   │ Create sales order model     │ sales_order.go +1 │
└─────┴────────────────┴──────────────────┴──────────────────────────────┴───────────────────┘

  ... (执行后输出统计表，复用 renderExecutionSummaryTable)
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/app/patch-session.ts` | 新文件 |
| `src/index.ts` | 注册 parallel_patch |
| `src/core/scheduler/scheduler.ts` | 新增 appendPatchTask 方法 |

---

## 三、持久化上下文缓存 + 时间点恢复

### 存储结构

```
.claude/parallel/context/
├── index.json                          # 全局索引（时间线）
├── mcp-02/
│   ├── task-1_20250115-143208.json     # 时间戳命名，永不覆盖
│   └── task-4_20250115-152301.json     # patch 产生的新快照
├── mcp-03/
│   └── task-2_20250115-143908.json
└── mcp-04/
    └── task-3_20250115-144200.json
```

### 快照类型

```typescript
interface TaskContextSnapshot {
  mcpId: string
  taskId: string
  sessionId: string
  roleType: string
  title: string
  requirement: string
  patchRequirement?: string
  status: string
  output: string            // worker 输出摘要
  files: string[]           // 涉及的文件
  durationMs: number
  tokens: number
  timestamp: string         // ISO
  createdAt: string         // 人类可读 MM-DD HH:mm:ss
}
```

### 写入时机

orchestrator.ts 中 task 完成时自动写入，fire-and-forget。

### parallel_context 工具

```
parallel_context(action: "list" | "show" | "restore", mcpId?, taskId?, timestamp?, projectRoot?)
```

#### list 输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📦  Context Cache Timeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  project    /Users/dev/venuecode
  snapshots  4
  span       01-15 14:32 → 01-15 15:23

┌──────────────────┬──────────┬──────────┬────────────────────────────┬──────────┬──────────┐
│ Time             │ MCP      │ Task     │ Title                      │ Status   │ Tokens   │
├──────────────────┼──────────┼──────────┼────────────────────────────┼──────────┼──────────┤
│ 01-15 14:32:08   │ mcp-02   │ task-1   │ Create sales order model   │ ✅ done  │ 12,400   │
│ 01-15 14:39:08   │ mcp-03   │ task-2   │ Refactor OrdersReport tabs │ ✅ done  │ 21,300   │
│ 01-15 14:42:00   │ mcp-04   │ task-3   │ Build handler and service  │ ✅ done  │ 14,620   │
│ 01-15 15:23:01   │ mcp-02   │ task-4   │ Fix model validation bug   │ ✅ done  │ 5,800    │
└──────────────────┴──────────┴──────────┴────────────────────────────┴──────────┴──────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  💡 Usage                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  parallel_context show mcp-02 task-1     查看快照详情                               │
│  parallel_context restore 01-15 14:32    恢复到该时间点继续开发                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

#### show 输出

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔍  Context Snapshot Detail
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  mcp        mcp-02
  task       task-1
  role       backend
  time       01-15 14:32:08
  session    session-1719000000000
  duration   38s
  tokens     12,400
  status     ✅ completed

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  📄 Files Modified                                                                 │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  server/internal/model/sales_order.go                                              │
│  server/internal/repository/sales_order_repo.go                                    │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  📝 Output Summary                                                                 │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Created SalesOrder model with 15 fields, added GORM AutoMigrate,                  │
│  implemented repository with List/Get/Summary methods...                           │
└──────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────┐
│  💡 Actions                                                                        │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  parallel_patch "fix ..." mcp-02    基于此上下文追加修改                             │
│  parallel_context restore 01-15 14:32    恢复到此时间点                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

#### restore 逻辑

按时间戳筛选该时间点及之前的所有快照，重建 session 状态：
- 该时间点之前完成的 task → completed
- 该时间点之后的 task → 丢弃
- session phase → running
- 可直接 parallel_patch 或 parallel_resume 继续

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/types.ts` | TaskContextSnapshot 类型 + PARALLEL_CONTEXT_DIR 常量 |
| `src/core/runtime/session-store.ts` | saveTaskContext / loadTaskContext / listContexts 方法 |
| `src/core/orchestrator.ts` | task 完成时写入上下文缓存 |
| `src/app/context-cache.ts` | 新文件：list / show / restore 逻辑 |
| `src/index.ts` | 注册 parallel_context |
| `src/core/terminal/renderers.ts` | renderContextList / renderContextDetail / renderContextRestore |

---

## 完整文件改动清单

| 文件 | 类型 | 改动 |
|------|------|------|
| `package.json` | 修改 | 添加 cli-table3 依赖 |
| `src/types.ts` | 修改 | TaskContextSnapshot + PARALLEL_CONTEXT_DIR |
| `src/index.ts` | 修改 | 传 server、注册 parallel_patch + parallel_context |
| `src/app/approve-session.ts` | 修改 | 接收 server 参数 |
| `src/app/resume-session.ts` | 修改 | 接收 server 参数 |
| `src/app/foreground-execution.ts` | 修改 | 实时推送 + 接收 server |
| `src/app/patch-session.ts` | 新增 | 追加任务逻辑 |
| `src/app/context-cache.ts` | 新增 | 上下文缓存 list/show/restore |
| `src/core/orchestrator.ts` | 修改 | task 完成时写入上下文缓存 |
| `src/core/runtime/session-store.ts` | 修改 | 上下文缓存读写方法 |
| `src/core/scheduler/scheduler.ts` | 修改 | appendPatchTask 方法 |
| `src/core/terminal/renderers.ts` | 修改 | 全部新增排版函数（cli-table3） |
