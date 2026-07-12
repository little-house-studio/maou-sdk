# 会话事件模型（Session Event）

> 原则：**author（谁）× kind（什么）× wireRole（怎么喂模型）** 三正交

## 三字段

| 字段 | 含义 | UI | 压缩/任务 | 模型 API |
|------|------|-----|-----------|----------|
| **author** | 谁发的 | 头栏标签 | 权限/归因 | 一般不直接暴露 |
| **kind** | 业务性质 | 气泡类型 | assignTaskIds | 间接 |
| **wireRole** | 协议角色 | 否 | 否 | user/assistant/tool/system |

### author

```ts
{
  type: "human" | "agent" | "system" | "tool"
  id?: string           // user / coding / use_terminal / todo
  displayName?: string  // UI 名
}
```

头栏展示：`user` · `agent:coding` · `system:todo` · `tool:use_terminal`

### kind

| kind | 默认 author.type | 默认 wireRole |
|------|------------------|---------------|
| human_user | human | user |
| queued_user | human | user |
| agent_message | agent | user（cache） |
| runtime_control | system | user（cache） |
| system_notice | system | user（cache） |
| tool_result | tool | tool |
| tool_async_notify | tool | tool |
| assistant_turn | agent | assistant |

## API

```ts
appendSessionEvent(sessions, sid, {
  kind: "system_notice",
  author: authorSystem("todo", "todo"),
  content: "...",
  source: "todo_notice",
});
```

Helpers: `authorHuman` / `authorAgent` / `authorSystem` / `authorTool` / `formatAuthorLabel` / `resolveMessageAuthor`.

## 兼容

旧 JSONL 无 author 时：`resolveMessageAuthor` 从 source/kind/tool_name/from 推断。
