# project

项目领域统一入口。`project_agent` 与 `project_manage` 仍是独立上帝工具。

- `list` / `create` / `send` → `project_agent`
- `disband` / `members` / `message` → `project_manage`
- 只派任务 → `project_send`
- 失效或搬家：对现在的绝对路径 `create`，不要 repair/rebind
