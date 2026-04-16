# mcp-dev-cli

## 技术栈

Node.js

## 项目结构

```
parallel platform layout
```

## MCP 协同开发规范

### 角色管理
- 角色文件统一放在 `.claude/agents/` 目录，后缀 `.md`
- 角色命名：英文小写 + 连字符（如 `frontend-skill`）
- 新增角色通过 `npx mcp-dev-cli roles add` 创建

### 断点保存规范
- 任务状态自动记录到 `.claude/context/task-checkpoint.json`
- 每个子任务完成/中断时立即更新 checkpoint
- 状态流转：pending → running → completed/failed

### 接口契约
- 前后端接口契约存入 `.claude/context/api-contract/`
- 每个 worker 启动时自动加载契约作为上下文
- 修改契约需通知所有相关角色

### Git 分支规范
- 协同开发分支命名：`mcp/<role>-<task-id>`
- 完成后自动合并到基准分支
- 不要手动修改 mcp/ 前缀的分支

## 代码规范

- 遵循项目现有的代码风格
- 新增代码必须通过编译检查
- 不引入不必要的依赖
