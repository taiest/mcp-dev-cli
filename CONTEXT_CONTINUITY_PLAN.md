# 上下文连续性改造方案（历史归档）

本文档保留为历史设计记录。

当前仓库已经完成产品收口，主表达已不再是早期多工具集合，而是统一的 `parallel_*` 平台。历史文档中的旧工具名、checkpoint 结构和早期上下文恢复设想，仅用于追溯设计演进，不再代表当前主实现。

## 当前有效主线

当前平台能力以以下工具为准：
- `parallel_init`
- `parallel_preflight`
- `parallel_start`
- `parallel_resume`
- `parallel_dashboard`
- `parallel_report`
- `parallel_model_switch`
- `parallel_contracts`

## 已落地方向

- 分析态 + 执行态可持久化
- session runtime 作为主恢复入口
- resume 会继续推进执行，而不只是展示状态
- recovery 会产出 retry / reassign / replan / resume 建议
- 产品对内对外统一表达为一个整体 parallel platform

## 说明

如果需要了解当前实现，请直接阅读：
- `src/index.ts`
- `src/app/start-parallel-session.ts`
- `src/app/resume-session.ts`
- `src/core/scheduler/*`
- `src/core/recovery/*`
- `src/core/report/*`

本文件不再继续维护为当前规范文档。
