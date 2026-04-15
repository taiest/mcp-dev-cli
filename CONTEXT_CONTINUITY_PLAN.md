# mcp-dev-cli 上下文连续性改造方案

## 1. 背景与问题

当前 `mcp-dev-cli` 已经完成了从 CLI 向 MCP Server 的转型，核心能力包括：
- `mcp_dev_init`
- `mcp_dev_start`
- `mcp_dev_resume`
- `mcp_dev_roles_list`
- `mcp_dev_roles_add`
- `mcp_dev_roles_remove`
- `mcp_dev_status`

但当前产品链路存在一个致命协作问题：

> 当用户在当前 Claude Code 会话中已经完成大量项目分析后，如果此时项目还没有接入 `mcp-dev-cli`，为了让 `.mcp.json` 生效，往往只能要求用户重启 Claude Code 或开启新会话。这样会导致工具虽然接入成功，但上一个会话中的需求分析、截图理解、任务拆分思路、产品约束和技术判断全部留在旧对话里，破坏协同连续性。

这个问题会直接削弱 `mcp-dev-cli` 作为“多角色并行协同开发工具”的价值。

---

## 2. 目标

本次改造目标不是新增更多角色或更多执行命令，而是优先解决：

1. **工具接入不打断当前分析上下文**
2. **即使必须新开会话，也能自动恢复分析态，而不只是恢复任务态**
3. **让 `mcp-dev-cli` 成为“项目级协同状态层”，而不是只依赖单轮聊天记录**

成功标准：
- 用户在分析需求后，即使项目尚未配置 `.mcp.json`，也不需要手工重复描述上下文
- 若配置变更必须重新加载 MCP，也能通过项目内持久化上下文无损恢复
- `resume` 恢复的不只是“任务进度”，还包括“为什么这样拆、哪些页面先做、哪些约束已经确认”

---

## 3. 当前问题拆解

### 3.1 现状问题

当前 README 的推荐流程是：
1. 在项目里配置 `.mcp.json`
2. 重启 Claude Code
3. 再开始对话使用 `mcp-dev-cli`

这个流程的问题是：
- 它假设工具接入发生在需求分析之前
- 它没有考虑真实开发过程中“先分析，再决定接工具”的场景
- 它把 MCP 注册状态与聊天上下文绑在一起

### 3.2 本质原因

`mcp-dev-cli` 目前只持久化了：
- 角色配置
- checkpoint 任务状态
- API contract

但没有持久化：
- 当前需求摘要
- 截图分析结论
- 已确认的产品约束
- 实施计划
- 已发现的风险与取舍
- 已完成的探索结论

也就是说，当前只恢复“执行态”，没有恢复“分析态”。

---

## 4. 改造原则

### 原则一：优先保留上下文连续性
不能把“重开会话”当作默认路径。

### 原则二：项目上下文必须落盘
重要分析不能只存在聊天线程里，必须沉淀到项目目录内可恢复的结构化文件。

### 原则三：resume 要恢复分析态 + 执行态
不仅要知道哪些任务 running/completed，还要知道当前项目为什么这样拆、哪些页面要先清理、哪些接口需要重做。

### 原则四：初始化与执行解耦
工具初始化失败，不应该阻断当前需求分析工作。

---

## 5. 推荐改造方案

本次建议按三层能力来改：

1. **热加载层**：尽量避免要求用户重开会话
2. **上下文持久化层**：即使重开，也不丢上下文
3. **恢复与桥接层**：让新旧会话之间可以平滑交接

---

## 6. 第一优先级：支持 MCP 热加载

### 6.1 目标
如果用户在当前会话中才补充 `.mcp.json`，应尽量不需要关闭会话。

### 6.2 推荐实现方向

#### 方案 A：提供显式 reload 命令
理想形态：
- `claude mcp reload`
- 或项目级 reload 子命令

若 Claude Code 本体暂不支持，可在 `mcp-dev-cli` 文档中先设计兼容位，并在工具内部预留检测逻辑。

#### 方案 B：在初始化流程里自动提示 reload
当检测到：
- 项目存在 `.mcp.json`
- 但当前会话未暴露 `mcp-dev-cli` 工具

则输出标准提示：
- 当前项目配置已写入
- 当前会话未加载 MCP server
- 如宿主支持 reload，优先执行 reload
- 若宿主不支持，再降级到新会话恢复机制

### 6.3 成功效果
用户在完成项目分析后：
1. 写入 `.mcp.json`
2. reload MCP
3. 当前会话继续调用 `mcp-dev-cli`

这是最佳路径。

---

## 7. 第二优先级：增加项目级上下文持久化

这是必须做的能力，即使未来支持热加载也仍然有价值。

### 7.1 新增目录结构
建议在项目中增加：

```text
.claude/context/
├── task-checkpoint.json
├── api-contract/
├── session-brief.md
├── product-context.md
├── screenshot-analysis.md
├── implementation-plan.md
├── discovered-risks.md
└── execution-handoff.md
```

### 7.2 各文件职责

#### `session-brief.md`
存当前任务的高层摘要。

建议内容：
- 当前目标
- 当前阶段
- 已确认范围
- 当前阻塞项

#### `product-context.md`
存产品与业务层结论。

建议内容：
- 页面范围
- 产品约束
- 不可更改项
- 用户确认过的方向

#### `screenshot-analysis.md`
存截图驱动开发时的界面归纳。

建议内容：
- 页面级模块拆解
- 筛选栏要求
- 汇总卡要求
- 表格列与交互要求
- 与现有页面差异

#### `implementation-plan.md`
存已经确认的实施方案。

建议内容：
- 清理顺序
- 并行派工建议
- 前后端改造边界
- 验证方案

#### `discovered-risks.md`
存目前发现的风险、未知项、技术限制。

建议内容：
- 接口口径不匹配
- 导出能力缺失
- MCP 未加载
- 工具权限限制

#### `execution-handoff.md`
存新旧会话交接摘要。

建议内容：
- 当前已完成分析
- 下一步建议动作
- 谁负责什么
- 各 agent 要读哪些上下文文件

---

## 8. 第三优先级：增强 resume，恢复“分析态”

### 8.1 当前问题
现在的 `mcp_dev_resume` 更像：
- 恢复任务状态
- 查看 checkpoint
- 继续执行未完成任务

但真实协同开发需要恢复的是：
- 任务为什么这样拆
- 哪些页面必须先清理
- 哪些截图字段必须对齐
- 哪些接口已经确认要重做
- 哪些约束已被用户确认

### 8.2 建议升级目标
`mcp_dev_resume` 启动时自动读取：
- `.claude/context/session-brief.md`
- `.claude/context/product-context.md`
- `.claude/context/screenshot-analysis.md`
- `.claude/context/implementation-plan.md`
- `.claude/context/discovered-risks.md`
- `.claude/context/task-checkpoint.json`

然后先生成一段“恢复摘要”，再决定后续执行。

### 8.3 输出形态建议
恢复时先输出：

```text
已恢复项目上下文：
- 当前目标：商户端数据中心 5 个报表页重构
- 当前阶段：正式开发前，先接 MCP 并准备派工
- 已确认约束：先清理旧页面；必须用多 Agent / 多 MCP 并行；截图为准
- 已知风险：orders/sales/card-value/balance 存在接口口径差异
- 下一步建议：执行派工前先完成 context-save / load 验证
```

这样 resume 才真正可用。

---

## 9. 新增桥接能力：context save / load

这是解决“旧会话分析已完成，但工具还没接上”最关键的补丁能力。

### 9.1 新增工具建议

#### `mcp_dev_context_save`
作用：把当前分析结果结构化保存到项目上下文目录。

输入建议：
```json
{
  "goal": "...",
  "constraints": ["..."],
  "analysis": "...",
  "plan": "...",
  "risks": ["..."],
  "nextSteps": ["..."]
}
```

输出：
- 保存成功摘要
- 写入了哪些文件

#### `mcp_dev_context_load`
作用：读取项目上下文文件，恢复当前任务摘要。

输入建议：
```json
{
  "projectRoot": "..."
}
```

输出：
- 当前项目上下文摘要
- 当前阶段
- 已确认约束
- 推荐下一步

### 9.2 典型使用场景

#### 场景 1：当前会话分析后才决定接入 MCP
1. 先完成需求分析
2. 调用 `context_save`
3. 配置 `.mcp.json`
4. reload 或新会话
5. 调用 `context_load`
6. 再执行 `mcp_dev_start`

#### 场景 2：多人协同接力
1. PM/主线程先做分析
2. 保存 context
3. worker / lead-router 读取 context
4. 再拆任务执行

---

## 10. 新增本地缓存机制：重启后自动恢复上下文

仅靠项目内 `.claude/context/` 还不够，因为存在两类真实场景：

1. 项目上下文还没来得及初始化，Claude Code 已经重启
2. 用户已经做了大量分析，但还没显式调用 `context_save`

因此除了项目级上下文持久化，还建议增加 **用户级本地缓存层**，用于在会话中断、Claude Code 重启、MCP reload 失败时兜底恢复最近分析状态。

### 10.1 设计目标

本地缓存层需要解决：
- 重启后还能恢复最近一次分析摘要
- 即使项目 `.claude/context/` 不完整，也能从本地缓存恢复
- 恢复的不只是任务进度，还包括分析态、计划态、约束态
- 不依赖完整聊天 transcript，而是保存结构化摘要

### 10.2 双层缓存结构

建议采用双层缓存：

#### A. 项目级缓存
放在项目目录内，适合团队共享与 agent 协同：

```text
.claude/context/
.claude/cache/
```

建议新增：

```text
.claude/cache/
├── context-index.json
├── latest-summary.json
├── latest-handoff.md
└── snapshots/
    ├── 2026-04-16T10-30-00Z.json
    └── 2026-04-16T10-45-00Z.json
```

用途：
- 保存最近一次项目分析快照
- 为 `resume` 和多 agent 提供统一上下文源
- 支持按时间回溯最近几次分析状态

#### B. 用户级本地缓存
放在用户目录，适合作为重启兜底：

```text
~/.claude/mcp-dev-cli/cache/
```

建议按项目 hash 分桶：

```text
~/.claude/mcp-dev-cli/cache/
└── <project-hash>/
    ├── latest-context.json
    ├── latest-analysis.md
    ├── latest-handoff.md
    ├── latest-session-meta.json
    └── snapshots/
        ├── 2026-04-16T10-30-00Z.json
        └── 2026-04-16T10-45-00Z.json
```

用途：
- Claude Code 重启后找回最近项目上下文
- 项目还未初始化 `.claude/context/` 时兜底
- 支持“恢复最近一次项目分析”能力

### 10.3 应该缓存什么

缓存内容必须覆盖 **分析态 + 执行态**。

#### 分析态
- 当前目标
- 已确认约束
- 截图分析结论
- 页面清理范围
- 接口差异
- 风险点
- 推荐下一步

#### 执行态
- 当前阶段
- 子任务列表
- agent 分工
- checkpoint 状态
- 当前分支
- 最近一次执行结果

#### 元信息
- `projectRoot`
- `projectHash`
- `updatedAt`
- `schemaVersion`
- `gitBranch`
- `gitHead`
- `sourceTool`
- `sessionId`（如果宿主可提供）

### 10.4 推荐缓存 schema

建议定义统一 JSON 结构：

```json
{
  "schemaVersion": 1,
  "projectRoot": "/Users/taiest/Documents/code/venuecode",
  "projectHash": "f5c7f0...",
  "updatedAt": "2026-04-16T10:30:00Z",
  "git": {
    "branch": "main",
    "head": "abc123"
  },
  "analysis": {
    "goal": "商户端数据中心 5 个报表页重构",
    "constraints": [
      "先清理旧页面",
      "必须使用多 Agent / 多 MCP 并行开发",
      "截图驱动开发"
    ],
    "screenshotSummary": "销售订单/销售统计/入场统计/会员卡价值统计/余额统计的目标 UI 与现状差异",
    "risks": [
      "orders/sales/card-value/balance 存在接口口径差异"
    ],
    "nextSteps": [
      "接入并验证 mcp-dev-cli",
      "清理旧页面结构",
      "再进行并行派工"
    ]
  },
  "execution": {
    "phase": "planning",
    "taskCheckpoint": {
      "status": "pending"
    },
    "agents": [
      "pm-agent",
      "frontend-skill",
      "backend-skill"
    ]
  },
  "files": {
    "sessionBrief": ".claude/context/session-brief.md",
    "implementationPlan": ".claude/context/implementation-plan.md"
  }
}
```

### 10.5 自动保存时机

建议在以下时机自动写缓存：

1. 完成一次需求分析后
2. 调用 `mcp_dev_start` 前
3. 派工计划生成后
4. `mcp_dev_resume` 前后
5. 检测到 `.mcp.json` 变更时
6. 检测到会话即将结束时（若宿主支持）
7. 执行 `mcp_dev_context_save` 时强制落盘

### 10.6 自动恢复顺序

启动恢复时按以下优先级读取：

1. 项目 `.claude/context/` 的显式上下文文件
2. 项目 `.claude/cache/latest-summary.json`
3. 用户级 `~/.claude/mcp-dev-cli/cache/<project-hash>/latest-context.json`
4. 用户级最近 snapshot

恢复后先生成统一摘要，再决定是否继续执行 `resume/start`。

### 10.7 缓存相关新工具建议

在 `context save / load` 之外，建议补充：

#### `mcp_dev_context_snapshot`
作用：
- 把当前上下文同时写入项目缓存和用户级本地缓存
- 生成一个可恢复快照

输入建议：
```json
{
  "projectRoot": "...",
  "reason": "before-mcp-reload"
}
```

#### `mcp_dev_context_restore`
作用：
- 自动读取项目级缓存 + 用户级缓存
- 生成最近可恢复上下文摘要

输入建议：
```json
{
  "projectRoot": "...",
  "preferLocalCache": false
}
```

可选进一步补充：

#### `mcp_dev_cache_list`
列出当前机器上有哪些项目缓存可恢复。

#### `mcp_dev_cache_clear`
清理当前项目或过期缓存。

### 10.8 缓存过期与一致性控制

缓存必须带版本和 git 信息，否则容易恢复到错误状态。

建议做以下校验：
- `schemaVersion` 不匹配时拒绝直接恢复
- `gitBranch` 不一致时提示用户当前分支已变化
- `gitHead` 差异较大时提示“代码已更新，缓存仅作上下文参考”
- snapshot 只保留最近 N 份（例如 10 份）
- 超过一定时间的本地缓存自动标记 stale

### 10.9 为什么不能只缓存聊天 transcript

不建议直接缓存完整对话，因为：
- 体积大
- 难以结构化消费
- 容易把无关噪音带回新会话
- 多 agent 无法直接高效读取

正确做法是缓存 **结构化摘要**，而不是原始 transcript。

### 10.10 最小可实现版本（缓存层）

建议先做 MVP：

1. 新增项目 `.claude/cache/latest-summary.json`
2. 新增用户级 `~/.claude/mcp-dev-cli/cache/<project-hash>/latest-context.json`
3. `mcp_dev_context_save` 同时写两处
4. `mcp_dev_context_load` 支持双层读取
5. `mcp_dev_resume` 自动尝试恢复缓存
6. 恢复时输出“检测到上次上下文，是否继续”摘要

这样即使 Claude Code 重启，用户也不会丢掉上一轮项目分析。

---

## 11. 新增桥接能力：context save / load

### 10.1 当前问题
现在用户容易把“工具能否启动”与“需求是否已经分析完”混成一件事。

### 10.2 建议改造
把产品工作流拆成两个层次：

#### 第一层：初始化层
负责：
- 检查项目结构
- 创建 `.claude/agents/`
- 创建 `.claude/context/`
- 初始化默认文件
- 检查 git / node / claude 环境
- 检查 MCP 注册情况

建议工具：
- `mcp_dev_init`
- `mcp_dev_context_save`
- `mcp_dev_context_load`

#### 第二层：执行层
负责：
- 拆任务
- 启动多角色进程
- 跟踪状态
- 自动合并
- 编译验证

建议工具：
- `mcp_dev_start`
- `mcp_dev_resume`
- `mcp_dev_status`

### 10.3 收益
- 即使执行层暂时不能启动，也不耽误分析层沉淀
- 当前会话分析结果能先落盘
- 工具接入时不再导致上下文断裂

---

## 11. 建议新增工具清单

在现有 7 个工具基础上，建议新增至少 2 个：

### 11.1 `mcp_dev_context_save`
保存当前任务分析摘要到 `.claude/context/`。

### 11.2 `mcp_dev_context_load`
从 `.claude/context/` 读取并恢复项目上下文。

可选进一步新增：

### 11.3 `mcp_dev_handoff`
生成适合多 Agent 阅读的任务交接摘要。

### 11.4 `mcp_dev_reload_hint`
检测当前项目是否存在 “已注册但当前会话未加载” 的状态，并给出最优恢复路径。

---

## 12. 建议的工作流调整

### 12.1 旧流程
```text
分析需求
  ↓
发现没接 MCP
  ↓
配置 .mcp.json
  ↓
重启 Claude Code
  ↓
重新解释需求
```

### 12.2 新流程（推荐）
```text
分析需求
  ↓
context_save
  ↓
配置 .mcp.json
  ↓
reload MCP（优先）
  ↓
若必须新会话，则 context_load
  ↓
mcp_dev_start / mcp_dev_resume
```

### 12.3 用户体验提升
- 不再要求用户重复讲一遍需求
- 分析、执行、恢复是连续的
- 多 Agent 协同真正建立在项目上下文上，而不是聊天窗口上

---

## 13. README 需要同步修改的内容

当前 README 中这句：

> 配置完成后，重启 Claude Code，就可以直接对话使用了。

建议改成更稳妥的表述：

```markdown
配置完成后，优先让 Claude Code 重新加载项目 MCP 配置；
如果宿主环境暂不支持热加载，再开启新会话，并通过项目 `.claude/context/` 自动恢复上下文。
```

另外 README 应新增一节：

### 上下文连续性
说明：
- `mcp-dev-cli` 不仅保存任务状态，也保存分析上下文
- 支持 `context_save` / `context_load`
- 支持中断恢复分析态

---

## 14. 最小可实现版本（MVP）

建议先做 MVP，不一次做太重。

### MVP 第一阶段
1. 新增 `.claude/context/` 下的上下文文件结构
2. 新增 `mcp_dev_context_save`
3. 新增 `mcp_dev_context_load`
4. 升级 `mcp_dev_resume`，读取上下文文件并输出恢复摘要
5. 更新 README 的接入与恢复流程

### MVP 第二阶段
6. 增加 `mcp_dev_reload_hint`
7. 优化 `mcp_dev_init`，自动创建上下文文件模板
8. 优化 `mcp_dev_start`，启动前自动读取上下文文件作为系统输入

### 后续增强
9. 如果宿主允许，再接入真正的 MCP 热加载支持
10. 将 handoff 自动喂给多角色 worker

---

## 15. 对源码的建议改动点

### 15.1 新增文件
建议新增：
- `src/tools/context.ts`
- `src/core/context-store.ts`
- `src/types/context.ts`

### 15.2 `src/index.ts`
新增 tool 注册：
- `mcp_dev_context_save`
- `mcp_dev_context_load`

### 15.3 `src/tools/resume.ts`
在恢复任务前，先读取上下文文件并生成恢复摘要。

### 15.4 `src/tools/start.ts`
在拆任务前优先读取：
- `session-brief.md`
- `product-context.md`
- `screenshot-analysis.md`
- `implementation-plan.md`

把这些内容作为 orchestrator 的输入上下文之一。

### 15.5 `src/tools/init.ts`
初始化时自动创建：
- `.claude/context/session-brief.md`
- `.claude/context/product-context.md`
- `.claude/context/screenshot-analysis.md`
- `.claude/context/implementation-plan.md`
- `.claude/context/discovered-risks.md`
- `.claude/context/execution-handoff.md`

---

## 16. 推荐实施顺序

1. 先补 README 中的问题说明与推荐流程
2. 增加 `.claude/context/` 的标准文件结构
3. 实现 `context-store` 读写层
4. 实现 `mcp_dev_context_save`
5. 实现 `mcp_dev_context_load`
6. 升级 `mcp_dev_resume`
7. 升级 `mcp_dev_start`
8. 最后评估是否支持热加载路径

---

## 17. 预期收益

改造完成后，`mcp-dev-cli` 会从“只能派工的 MCP 工具”升级成“可持续协作的项目上下文操作系统”：

- 工具接入不再破坏当前分析结果
- 多轮会话之间可恢复完整上下文
- resume 真正恢复协作状态，而不是只恢复任务进度
- 多 Agent 拿到的是统一项目上下文，不是各自猜测的需求
- 用户不需要因为工具问题重复讲一遍业务背景

---

## 18. 结论

`mcp-dev-cli` 当前最需要解决的不是更多执行命令，而是：

**让工具接入、上下文分析、任务执行、断点恢复成为一条连续链路。**

正确方向是：
- **优先支持热加载**
- **必须补齐项目级上下文持久化**
- **让 resume 恢复分析态 + 执行态**
- **增加 context save / load 作为桥接能力**

这样它才真正适合作为多角色并行协同开发工具长期使用。
