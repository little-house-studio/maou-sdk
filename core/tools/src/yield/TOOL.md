## 使用指引

- 子 Agent 完成任务后调此工具提交结构化结果，fork 检测到 yield 后结束子 Agent 循环，把结果交回父 Agent。
- 仅在作为子 Agent（被 `agent_message` fork 或 `subagent_<name>` 委托调用）时使用——主 Agent 不要调用 yield。
- `result` 必填，是给父 Agent 的最终产出：可以是纯文本，也可以是 JSON 字符串。若父 Agent 设了 `outputSchema`，应按 schema 输出 JSON 字符串；校验失败会反馈错误让你重新 yield（最多重试 3 次）。
- `summary` 可选，一句话说明结果要点（200 字内），便于父 Agent 快速预览。
- yield 是子 Agent 的「收尾」工具：调了即结束，不要再调其它工具；也不要在任务未完成时调。
- 若当前不是子 Agent 上下文（`ctx.yieldResult` 未注入），工具返回错误提示——说明你现在是主 Agent，直接回复用户即可，不需要 yield。
