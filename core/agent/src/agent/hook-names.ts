/**
 * 生命周期钩子名表 —— 单一真相源。
 *
 * StreamEvent.type（assistant_delta / response_chunk 等）不是 hook。
 * 别名注册/触发都落到规范名，只打一次。
 */

/** 规范名（触发与文档都用这个） */
export const CANONICAL_HOOKS = [
  // 工具
  "pre_tool_use",
  "post_tool_use",
  "post_tool_use_failure",
  "post_tool_batch",
  "tool_error",
  "agent_request",
  "fs_write_intent",
  "fs_edit_intent",
  // 循环 / 收尾闸
  "before_agent_start",
  "agent_start",
  "agent_thinking",
  "agent_stop",
  "stop",
  "stop_failure",
  "loop_end",
  "abort",
  "error",
  // 消息 / 回复
  "pre_message",
  "post_message",
  "response_start",
  "response_end",
  "expression_change",
  // 上下文
  "pre_compact",
  "post_compact",
  "pre_cache_rebuild",
  "cache_rebuild_point",
  "post_cache_rebuild",
  "prompt_refresh",
  // 会话 / 子 agent
  "session_start",
  "session_end",
  "session_fork",
  "subagent_start",
  "subagent_stop",
  // 审批
  "permission_request",
  "permission_denied",
  // 终端（use_terminal；不接 list / logs / 逐行输出）
  "terminal_pre_run",
  "terminal_pre_write",
  "terminal_pre_stop",
  "terminal_pre_rm",
  "terminal_started",
  "terminal_promoted",
  "terminal_exit",
  "terminal_until_hit",
  "terminal_write",
  "terminal_stop",
  "terminal_rm",
  // 通知
  "notification",
  // 宿主转发（Hub / ConfigStore 调用 Runtime.notify*）
  "device_online",
  "device_offline",
  "config_change",
] as const;

export type CanonicalHookName = (typeof CANONICAL_HOOKS)[number];

export const CANONICAL_HOOK_SET: ReadonlySet<string> = new Set(CANONICAL_HOOKS);

/**
 * 历史 / Pi / Claude·Codex·Grok PascalCase / 文件名别名 → 规范名。
 * 注册 `tool_call` 等于注册 `pre_tool_use`。
 */
export const HOOK_ALIASES: Readonly<Record<string, CanonicalHookName>> = {
  tool_call: "pre_tool_use",
  tool_result: "post_tool_use",
  session_before_compact: "pre_compact",
  session_compact: "post_compact",
  on_user_message: "pre_message",
  on_user_input: "pre_message",
  UserPromptSubmit: "pre_message",
  PreToolUse: "pre_tool_use",
  PostToolUse: "post_tool_use",
  PostToolUseFailure: "post_tool_use_failure",
  PostToolBatch: "post_tool_batch",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  Stop: "stop",
  StopFailure: "stop_failure",
  StopCancelled: "abort",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  PermissionRequest: "permission_request",
  PermissionDenied: "permission_denied",
  Notification: "notification",
  // DeepSeek Harness 原生 Cordis 名（文件名用下划线）
  "tools/pre-execute": "pre_tool_use",
  tools_pre_execute: "pre_tool_use",
  "tools/post-execute": "post_tool_use",
  tools_post_execute: "post_tool_use",
  "tools/result": "post_tool_use",
  tools_result: "post_tool_use",
  "agent/session-start": "session_start",
  agent_session_start: "session_start",
  "agent/pre-step": "before_agent_start",
  agent_pre_step: "before_agent_start",
  "agent/turn-stopping": "stop",
  agent_turn_stopping: "stop",
  "agent/request": "agent_request",
  "agent/request-error": "stop_failure",
  agent_request_error: "stop_failure",
  "approval/request": "permission_request",
  approval_request: "permission_request",
  "subagent/start": "subagent_start",
  "subagent/end": "subagent_stop",
  subagent_end: "subagent_stop",
  "fs/write-intent": "fs_write_intent",
  "fs/edit-intent": "fs_edit_intent",
  TerminalPreRun: "terminal_pre_run",
  TerminalPreWrite: "terminal_pre_write",
  TerminalPreStop: "terminal_pre_stop",
  TerminalPreRm: "terminal_pre_rm",
  TerminalStarted: "terminal_started",
  TerminalPromoted: "terminal_promoted",
  TerminalExit: "terminal_exit",
  TerminalUntilHit: "terminal_until_hit",
  TerminalWrite: "terminal_write",
  TerminalStop: "terminal_stop",
  TerminalRm: "terminal_rm",
};

/** 规范名 + 别名（register 时「已知」） */
export const ALL_HOOKS: ReadonlySet<string> = new Set([
  ...CANONICAL_HOOKS,
  ...Object.keys(HOOK_ALIASES),
]);

export type HookName = CanonicalHookName | keyof typeof HOOK_ALIASES;

export function resolveHookName(name: string): string {
  return HOOK_ALIASES[name] ?? name;
}

export function isKnownHookName(name: string): boolean {
  return ALL_HOOKS.has(name) || CANONICAL_HOOK_SET.has(resolveHookName(name));
}
