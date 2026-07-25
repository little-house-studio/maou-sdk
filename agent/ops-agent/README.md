# @little-house-studio/ops-agent

机器级 Maou Ops Agent。

- `maou`：从任意目录进入同一个 Ops Agent。
- 数据与会话固定在 `$MAOU_HOME/ops`（默认 `~/.maou/ops`）。
- Agent 实例固定在 `$MAOU_HOME/agents/ops`。
- 不在调用命令的目录创建 `.maou`。
- 使用 `project_agent` 查看/创建/委派 `maou coding` 项目任务。
- 使用 `change_self` 把 Agent 自身改造交给隔离维护子 Agent。

Coding Agent 仍通过 `maou coding` 启动，并在当前项目创建 `.maou`、注册到全局 `projects.json`。
