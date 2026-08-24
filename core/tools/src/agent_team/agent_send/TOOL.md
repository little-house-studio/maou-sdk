# agent_send

向已有队友或运行中的子 Agent 说话。

- 必填：`to`
- `mode`：`message`（默认，派活/补一句）/ `insert`（插队）/ `interrupt`（打断并带话）/ `stop`（停止）
- `content`：message / insert / interrupt 必填；stop 可不填
- 不创建、不 fork。要开新的子任务用 `agent_message`。
