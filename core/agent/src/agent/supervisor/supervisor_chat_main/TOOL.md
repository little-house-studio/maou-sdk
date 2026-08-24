# supervisor_chat_main

监督 Agent → 主 Agent 沟通工具（仅 `/goal` 监督模式下可用）。

## 用途

监督 Agent 通过此工具把指令派给主 Agent。主 Agent 执行一轮 loop（可能多次工具调用）后汇报，工具返回主 Agent 的最终输出文本。

监督 Agent 据此判断任务是否完成：
- 完成 → 调用 `supervisor_task_control` action=`confirm_end`
- 未完成 → 再次调用 `supervisor_chat_main` 派发后续指令

## 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| message | string | 是 | 发给主 Agent 的指令/消息 |
| wait | boolean | 否 | 是否等待主 Agent 完成（默认 true） |

## 工作流程

```
监督 Agent → supervisor_chat_main(message) → 主 Agent run() 一轮 loop
                                                      ↓
                                                  汇报输出
                                                      ↓
监督 Agent ← 工具返回 ←────────────────────────────────┘
```

## 限制

- 仅在监督 Agent session 内可用
- 监督状态必须为 `started`
- 依赖 harness 注入 `callMainAgent` 函数
