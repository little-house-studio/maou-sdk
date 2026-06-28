## 使用指引

- 子 Agent 管理，用于并行处理复杂任务。
- action=create：创建子 Agent 执行任务，需指定 name 和 task。
- action=status：查看子 Agent 状态；action=output：获取子 Agent 输出。
- action=stop：停止子 Agent；action=update-task：更新任务描述。
- 简单任务不需要子 Agent，直接执行即可。
- 子 Agent 完成后用 output 获取结果，再整合到主回复中。
- limit 控制 output 返回的消息数，默认 5。
