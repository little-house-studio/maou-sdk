# 会话存储 v1

只认 `format: "maou.session.v1"`。磁盘上旧的扁平 `<id>.jsonl` / `.ledger.jsonl` / `.meta.json` 不迁、不读。

原则：**author（谁）× kind（什么）× wireRole（怎么喂模型）** 三正交；`events.jsonl` 是唯一真相，只追加。

## 磁盘布局

项目 `.maou/sessions/<id>/`（ops 在 `~/.maou/ops/.maou/sessions/<id>/`）：

```
session.json          # 头（可原子改；title / title_source / lifetime / replace_generation 是列表缓存）
events.jsonl          # 活日志，明文只追加
events.offset.jsonl   # seq → 字节偏移 + crc32
events.<from>-<to>.jsonl.gz + .idx.jsonl   # 密封旧段（活文件仍明文）
events.sealed.json    # 密封段清单
fold.json             # 人看到的当前枝缓存
harness.json          # 派生工作集
harness.bak.json      # 压缩前备份
raw.jsonl             # LLM POST，log-only（禁止 token delta）
search.sqlite         # 可选 FTS，派生可关
plan/state.json       # Plan 小状态机
plan/plan.md          # 给人读的计划合同
goal-harness/         # 宿主编排 sidecar（不是 session-goal）
checkpoints/<cpId>/   # leaf_seq + 可选快照
```

会话根（`sessions/`）另有 `list-cache.json`：列表只读这份投影（id / title / 时间 / 条数 / leaf_seq），不 parse `last_raw_response`。点开走 `recoverCold` + `loadRecent`，不整枝 `load()`。

`session.json`：`format`、`id`、`title`、`title_source`、`lifetime`、`replace_generation`、`agent_name`、`created_at`、`updated_at`、`parent_session_id`、`fork_boundary_id`、`prefix_ref`、`leaf_id` / `leaf_seq`、`message_count`、`permission_preset`、`send_mode`。标题以 `session/title` 事件折叠为准；`title` 只作列表缓存。不把 `last_prompt` / `last_raw_response` 当合同。套餐钉在创建时；设置页改默认只影响新会话。

Goal（`/goal`）没有独立状态文件：只从 `events.jsonl` 的 `goal/change` 折叠。`activation` 只在进程里，resume/fork 后要显式 rearm。

Plan 的合同仍是 `plan.md` + `state.json`；`plan/change` 只是审计镜像。

## 应用语义

- **清空 = 删除整卷**（列表里也没了）。删的是当前会话时再开一个空会话。
- **回滚**：只改「当前看到哪一轮」（`leaf_*`），后悔的几轮留在 `events.jsonl`。
- **子会话**：平时只存分叉之后的后缀，前缀用 `prefix_ref` 指向母会话。删母时先把依赖者需要的前缀物化进各自目录，再删母；拷失败则不删母。
- **长会话 UI**：`loadRecent` / `loadOlder` 从文件尾向前，跨 `prefix_ref`；模型窗口仍走 harness。

`events.jsonl` 禁止整文件重写。唯一允许的重写：删母时把前缀物化进子会话自己的 `events.jsonl`。

## author × kind × wireRole

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
| tool_call | agent | assistant |
| tool_result | tool | tool |
| tool_async_notify | tool | tool |
| assistant_turn | agent | assistant |
| compact | system | user |
| unknown | system | user |

新写入必须显式带 `kind` + `author` + `source`。

## 事件源

每条：`seq`、登记过的 `domain/action`、`surface`（`log` | `model` | `ui`），可挂 `messageId`。未知 type 拒写。

CORE_SPECS 含消息族（`user/message`、`assistant/message`、`tool/call` …）以及：

- `tool/dispatch`：flush 成功之后、真正执行之前。冷打开时：有 call 无 dispatch → `tool/result { code: tool_not_started }`；有 dispatch 无结果 → `tool_outcome_unknown`。合成结果只追加。
- `turn/start` / `turn/end`：`surface: log`。`run()` 在 `markLive` 后写 start，结束写 end。冷打开时未配对的 start 只追加一条 `turn/end { recovered: true }`，已提交的消息不动。热着不合成。
- `compact/start` / `compact/summary` / `compact/end`：`surface: log`，不进 UI 消息族。未配对的 start 是锁。检查点消息可带 `surfaceOp: { op: "replace", start, end }`，不改原始日志。
- `session/title`：`source: draft | polished | user`。`user` 钉住后自动润色不再覆盖。

以及 `session/fork`、`session/rollback`、`session/branch`、`message/pin`（及 unpin/label）。

权限 / 队列 / 人机面（`surface: log`，不进 harness / 模型历史）：

- `permission/upgrade`：本轮笼子升级（只准这一次 spawn）。
- `inbox/enqueue` · `inbox/claim` · `inbox/cancel` · `inbox/deliver`：内存队列的账本镜像（带 queue id、mode、是否真正跑过）。
- `message/feedback`：已落盘助手消息赞踩（`up|down` + 可选说明）；两边都改过时带 `conflict`。
- `job/register` · `job/complete` · `job/wake`：后台任务登记与叫醒。

工具事件（仍走 `tool/call` / `tool/result`）：

- `ask_user`：根会话问卷 / 计划审阅；人答完再写 result。
- `report_to_parent`：仅子会话；`wake` 入父 inbox，否则进父动态区。

精确读（`loadRecent` / `loadOlder` / `readEvent`）只走 sidecar + jsonl，不打开 `search.sqlite`。`MAOU_SESSION_FTS=0` 时分页照常，`search()` 报错。活会话搜索把未刷队列盖在磁盘命中上。

```ts
appendSessionEvent(sessions, sid, {
  kind: "system_notice",
  author: authorSystem("todo", "todo"),
  content: "...",
  source: "todo_notice",
});

registerLedgerEvent({
  type: "plan/accept",
  surface: "model",
  description: "用户接受计划",
});
appendLedgerEvent(sessionDir, sessionId, "plan/accept", { planId });
```

Helpers: `authorHuman` / `authorAgent` / `authorSystem` / `authorTool` / `formatAuthorLabel` / `resolveMessageAuthor`。

模型用 reader/grep 读 `sessions/<id>/session.json`、`events.jsonl`、`harness.json`。

## SessionStore

按目录枚举，不 `glob *.jsonl`。列表只读各目录的 `session.json`。

- `create` / `appendEvent`（内部 stamp seq、树字段、更新 `session.json`）
- `loadRecent(id, { limit, beforeSeq? })` / `loadOlder`：从本文件尾向前扫消息事件；不够且有 `prefix_ref` 再读母文件。`beforeSeq` 是跨前缀的 absSeq。
- `foldBranch(id)`：当前 leaf 的完整投影，给 LLM / fork / export
- `forkFromEntry` / `forkSession`：子目录只写后缀 + `prefix_ref`
- `branchTo` / `rollbackTo`：追加事件，改 `leaf_*`
- `listDependents` / `previewDelete` / `deleteSession`（先物化依赖者）
- `clearSession` = `deleteSession`

没有 `save()`，没有 `MAX_MESSAGES_IN_MEMORY` 加载截断。
