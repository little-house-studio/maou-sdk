## 使用指引

- **主路径**：`action=fork`（或 `create`，同义）+ `task`。**默认同步等待**，tool_result 含 `── 输出 ──`。
- **后台**：`detached=true` 立即返回 taskId；进度用 `agent_manage list`。
- **再说话 / 停止**：用 `agent_send`（message / insert / interrupt / stop）。
- todo 并行层由 harness 自动调度，不要用本工具开并行层。
- 子 Agent 可用 `yield` 提交结构化结果（配合 `output_schema`）。
- 简单任务不要开子 Agent。
