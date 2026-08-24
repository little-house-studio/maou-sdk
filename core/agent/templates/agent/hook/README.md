# hook —— 生命周期钩子脚本

本目录脚本监听 hook 事件。文件名 = 规范名或别名（`pre_tool_use.ts`、`tools_pre_execute.ts`、`Stop.ts`）。
导出 `default` / `handler` / 与文件名同名的函数。实例 `hook/` 后于模板注册。

别名只打一次：`tool_call` = `pre_tool_use`，`tools/pre-execute` = `pre_tool_use`。

## 返回值

| 返回 | 效果 |
|---|---|
| `false` / 非空字符串 / `{ block, reason }` | 拦截（工具、用户消息、本步） |
| `{ cancel: true }` | 取消压缩 / 跳过缓存重建；`stop` 上等同继续跑 |
| `{ continue: true }` | `stop` / `stop_failure`：不要收尾，把 `reason`/`message` 喂回模型 |
| `{ content }` | 改写 tool result |
| `{ systemPrompt }` | 追加系统提示 |
| `{ message }` | 改写用户消息（`pre_message`） |
| `{ decision: "allow"\|"deny"\|"ask" }` 或 `{ approve }` | `pre_tool_use` 的 ask 会再走 `permission_request`；未批准则拒绝 |
| `{ command }` / `{ data }` | `terminal_pre_run` 改写命令；`terminal_pre_write` 改写键盘输入 |

## DeepSeek Harness（dsh）原生 Cordis 闸门

dsh 的扩展点不是 Claude 那 30 个 hook 名，而是进程内事件。Claude/Codex 只是它上面的兼容桥（只映射其中一小撮）。

| dsh | 我们 | 作用 |
|---|---|---|
| `agent/session-start` | `session_start` | 一次 run 开始 |
| `agent/pre-step` | `before_agent_start` | 每步模型调用前；可拒本步 |
| `agent/request` | `agent_request` | 即将调 LLM；可拦 |
| `agent/request-error` | `stop_failure` | 本轮因 API/校验结束 |
| `agent/turn-stopping` | `stop` | 本轮要结束；可 steer 再跑 |
| `tools/pre-execute` | `pre_tool_use` | allow / deny / **ask**（ask 再走审批，无批准则拒绝） |
| `tools/post-execute` | `post_tool_use` | 工具成功后，可改写结果 |
| `approval/request` | `permission_request` | 审批；终端命令也会打 |
| `subagent/start` · `subagent/end` | `subagent_start` / `subagent_stop` | 子 agent 起停 |
| `fs/write-intent` · `fs/edit-intent` | 同名 | `write_file` / `edit_file` 在 pre_tool_use 之前 |

文件名用下划线：`tools_pre_execute.ts`、`agent_pre_step.ts`、`agent_turn_stopping.ts`。

## Codex / Grok Build 交叉（PascalCase 别名）

| 规范名 | 别名 | 时机 |
|---|---|---|
| `pre_message` | UserPromptSubmit | 用户消息入会话前；可拦、可改写 |
| `post_tool_use_failure` | PostToolUseFailure | 工具失败（Grok；成功仍走 `post_tool_use`） |
| `post_tool_batch` | PostToolBatch | 本轮全部工具提交后 |
| `permission_denied` | PermissionDenied | 审批被拒 |
| `abort` | StopCancelled | 用户中断 |
| `notification` | Notification | idle / cancelled |
| `session_end` | SessionEnd | run 结束 |
| `pre_compact` / `post_compact` | PreCompact / PostCompact | 压缩前后 |

缓存重建点见 `cache_rebuild_point`。`pre_cache_rebuild` 返回 `{ cancel: true }` 可跳过本次重建。

## 终端（`use_terminal`）

通用 `pre_tool_use` 仍会先打。下面是审批通过之后、真正碰 PTY/进程的一层。不接 `list` / `logs` / 逐行输出。

闸门（可拦；`command`/`data` 可改写）：

| 规范名 | 时机 |
|---|---|
| `terminal_pre_run` | 审批通过后、真正跑命令前 |
| `terminal_pre_write` | `action=write` 前 |
| `terminal_pre_stop` | `manage stop` 前 |
| `terminal_pre_rm` | `manage rm` 前 |

观察：

| 规范名 | 时机 |
|---|---|
| `terminal_started` | 已有 terminal id（前台或后台） |
| `terminal_promoted` | 前台 timeout 转入后台 |
| `terminal_exit` | 进程结束（带 `exit_code`） |
| `terminal_until_hit` | `return_when=until` 命中 |
| `terminal_write` / `terminal_stop` / `terminal_rm` | 对应操作成功之后 |

文件名示例：`terminal_pre_run.ts`、`TerminalPreRun.ts`。
