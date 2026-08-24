## 使用指引（会话级 Todo + 自动调度）

与 **agent_message / supervisor_task_control / 飞书任务** 无关。

- **create**：提交带 deps 的计划表；后端自动依赖锁与 lane 分配（root 占 1 + 并行 fork）。
- **replace**：仅当**没有** in_progress / 活跃 fork 时允许；执行中禁止。
- **delete**：归档并清空。
- **list**：查看清单与 lane。
- 不要手搓并行 fork——分身由系统创建。
- 每完成一步：负责该节点的 agent 调用 **todo_finish**（一次一个节点）。
- 3 步以内直线任务可不建表。
