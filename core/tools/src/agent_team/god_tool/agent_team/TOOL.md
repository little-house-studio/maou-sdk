# agent_team

团队领域统一入口。`agent_message` 与 `agent_manage` 仍是独立上帝工具。

- `fork` / `create_subagent` → `agent_message`
- `list` / `create` / `dispatch` / `stop` / `message` / `interrupt` / `insert` / `remove` → `agent_manage`
- 派活 / 插话 / 中断 / 停止 → `agent_send`
- todo 并行层由 harness 自动调度，不是本工具的 action
