## 使用指引

- 委托任务给子 Agent（文件即子 Agent 约定）。
- 子 Agent 在独立 session 中执行，拥有独立的 agent 配置（agent.json / ROLE）。
- 调用此工具后，主 Agent 会等待子 Agent 完成并接收其最终输出。
- 工具名形如 `subagent_<name>`，每个子 Agent 对应一个工具。
- 仅在任务确实需要委派给专用子 Agent 时使用；简单任务直接执行即可。
- 与 agent_message 的区别：agent_message fork 克隆子 Agent（继承主配置）；subagent_delegate 委托给独立配置的子 Agent。
