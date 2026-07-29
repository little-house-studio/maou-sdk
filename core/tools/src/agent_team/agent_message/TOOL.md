## 使用指引

- **主路径**：`action=fork`（或 `create`，同义）+ `task`。**默认同步等待**，tool_result 含 `── 输出 ──`，无需再调 output。
- **后台**：`detached=true` 立即返回 taskId；进度用 `agent_manage list`，不要用旧 HTTP 式 output。
- **并行一层**：先 `todo_manage` 建清单，再 `action=fork_layer`。
- **可选缓存**：`list` / `status` / `output`（需 name=taskId）读本进程 fork 结果缓存；进程重启后缓存清空。
- 子 Agent 可用 `yield` 提交结构化结果（配合 `output_schema`）。
- 简单任务不要开子 Agent。
