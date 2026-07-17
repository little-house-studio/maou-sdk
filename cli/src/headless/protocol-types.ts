/**
 * Node ↔ Ratatui 语义协议（与 tui-ratatui/src/protocol.rs 对齐）。
 * 业务状态在 Node；Rust 只渲染与采集输入。
 */

export interface ProtoToolCard {
  id: string;
  name: string;
  args: string;
  result?: string;
  is_error?: boolean;
  done: boolean;
  duration_ms?: number;
  expanded?: boolean;
}

export interface ProtoThinking {
  id: string;
  content: string;
  streaming: boolean;
  duration_ms?: number;
  collapsed?: boolean;
}

export interface ProtoMessage {
  id: string;
  role: string;
  content: string;
  ts?: number;
  streaming?: boolean;
  tools?: string[];
  tool_cards?: ProtoToolCard[];
  thinking?: ProtoThinking[];
  duration_ms?: number;
  round?: number;
  kind?: string;
  author_label?: string;
  /** Per-message usage (Ink MessageRow ↑/↓ compact). */
  usage_input?: number;
  usage_output?: number;
}

export interface ProtoSystemEvent {
  id: string;
  kind: string;
  content: string;
  ts?: number;
  detail?: string;
}

export interface ProtoSelectItem {
  value: string;
  label: string;
  description?: string;
}

export interface ProtoCompletionItem {
  value: string;
  label: string;
  description?: string;
}

export interface ProtoCompletions {
  items: ProtoCompletionItem[];
  sel: number;
  prefix: string;
  range: { start: number; end: number };
}

export interface ProtoTerminalApproval {
  id: string;
  command: string;
  agent_name?: string;
  /** @deprecated 用 summary */
  hint?: string;
  /** low | high */
  risk?: string;
  /** 人话简介 */
  summary?: string;
  label?: string;
  rule_id?: string;
  reason?: string;
}

/** 底栏一段：主题 label/色 + nav-actions 动作（Rust 勿硬编码） */
export interface ProtoNavItem {
  id: string;
  label: string;
  short: string;
  bg?: string;
  bg_hover?: string;
  fg?: string;
  fg_hover?: string;
  /** command | hotkey | toast | noop */
  action_kind?: string;
  action_value?: string;
}

export interface ProtoTheme {
  bg?: string;
  panel_bg?: string;
  fg?: string;
  muted?: string;
  dim?: string;
  accent?: string;
  accent2?: string;
  ok?: string;
  warn?: string;
  err?: string;
  info?: string;
  user?: string;
  assistant?: string;
  system?: string;
  tool?: string;
  tool_result?: string;
  user_bg?: string;
  system_bg?: string;
  footer_bg?: string;
  input_field_bg?: string;
  border?: string;
  selected_bg?: string;
  assistant_md_bg?: string;
  md_heading?: string;
  md_heading2?: string;
  md_heading3?: string;
  md_code?: string;
  md_code_block?: string;
  md_quote?: string;
  md_quote_border?: string;
  md_list_bullet?: string;
  md_link?: string;
  md_hr?: string;
  tool_diff_added?: string;
  tool_diff_removed?: string;
  tool_diff_context?: string;
  /** @deprecated 用 nav_items；保留兼容旧 Rust */
  nav_agent?: string;
  nav_sessions?: string;
  nav_terminal?: string;
  nav_todo?: string;
  nav_inbox?: string;
  nav_notice?: string;
  nav_settings?: string;
  nav_agent_hover?: string;
  nav_sessions_hover?: string;
  nav_terminal_hover?: string;
  nav_todo_hover?: string;
  nav_inbox_hover?: string;
  nav_notice_hover?: string;
  nav_settings_hover?: string;
  /** 主题 nav.order + items + nav-actions（动态段数） */
  nav_items?: ProtoNavItem[];
  sel_bg?: string;
  sel_fg?: string;
}

export interface ProtoSupervisor {
  active: boolean;
  state: string;
  plan?: string;
  verify_rounds?: number;
  last_verdict?: string;
}

export interface ProtoChrome {
  status: string;
  streaming: boolean;
  aborting?: boolean;
  event_mode?: string;
  up_tokens?: number;
  down_tokens?: number;
  detail?: string;
  approval_mode?: string;
  approval_label?: string;
  agent?: string;
  provider?: string;
  model?: string;
  max_context?: number;
  used_tokens?: number;
  cache_label?: string;
  /** 0–100 when cache eligible (Ink InfoBar thresholds) */
  cache_pct?: number;
  cache_eligible?: boolean;
  session_id?: string | null;
  toast?: { text: string; kind: string } | null;
  overlay?: string | null;
  pending_count?: number;
  empty_hint?: string;
  back_to_bottom?: boolean;
  input_placeholder?: string;
  lite?: boolean;
  history_base?: number;
  perf_hud?: boolean;
  /** Ink PerfHud multi-line text (right-top); empty = hide */
  perf_lines?: string[];
  /** hot | warm | ok */
  perf_heat?: string;
  supervisor?: ProtoSupervisor | null;
  /** Ink eventBlockExpanded */
  event_block_expanded?: boolean;
  /** Ink supervisorMessages contents for expanded EventBlock (12-line view) */
  supervisor_messages?: string[];
}

export interface ProtoOverlay {
  kind: string;
  title: string;
  footer: string;
  items: ProtoSelectItem[];
  /** help / prompt 纯文本行 */
  lines?: string[];
  selected?: number;
  /** prompt 等：分段目录（value=id, label=title） */
  sections?: ProtoSelectItem[];
  /** 当前分段下标（0-based） */
  section_index?: number;
}

/** Node → TUI */
export type NodeToTuiMsg = Record<string, unknown>;
