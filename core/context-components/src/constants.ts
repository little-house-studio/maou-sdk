/**
 * 上下文层常量定义。
 */

// ─── 压缩触发阈值 ──────────────────────────────────────────

/** 窗压 / 自动压缩门槛：占用达到窗口的 80%（对齐 DSH thresholdRatio 0.8） */
export const MICRO_TRIGGER_PERCENT = 80;

/** 大压缩触发阈值：与窗压同一条 80% 线；便宜剪完仍超线才折叠 / 摘要 */
export const SUMMARY_TRIGGER_PERCENT = 80;

/** 归档触发阈值：大压缩后若仍 >= 90%，升级到 archive_zone（极端场景） */
export const ARCHIVE_TRIGGER_PERCENT = 90;

/** 折叠区占窗口达到该比例，下一次大压缩改为 LLM 归档 */
export const FOLD_ARCHIVE_PERCENT = 50;

/** 工具裁切后的原记录保留多久，过期删除 */
export const ORIGINAL_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 单条消息超过此字符数且未标注 micro_compact，自动参与微压缩 */
export const MICRO_SINGLE_MSG_CHARS = 800;

/**
 * 最近原文区：从尾部按条数比例留下。
 * 微压缩与大压缩共用同一边界。
 */
export const RETAIN_TAIL_RATIO = 0.16;

/** @deprecated 条数窗口已改为 RETAIN_TAIL_RATIO；仅兼容旧调用 */
export const ACTIVE_WINDOW_PERCENT = 40;

/** @deprecated 改为至少留最新一条不可拆单元 */
export const ACTIVE_WINDOW_MIN_MESSAGES = 6;

/**
 * active 区以外的消息：超过此字符即参与微压缩（强化旧侧；原 800 过高导致几乎不压）。
 * tool_result 另见更低阈值。
 */
export const MICRO_OUTSIDE_MIN_CHARS = 200;

/** tool_result 在 active 外超过此长度必微压 */
export const MICRO_TOOL_RESULT_MIN_CHARS = 120;

/** 单条微压缩摘要最大字符数 */
export const MICRO_SUMMARY_MAX_CHARS = 100;

/** 自动 checkpoint 最多保留个数（超出删最旧；防 tool 全量拷盘爆） */
export const MAX_AUTO_CHECKPOINTS = 8;

/** 任务摘要每条最大字符数 */
export const SUMMARY_MAX_CHARS = 500;

/** 任务块摘要最大字符数 */
export const TASK_SUMMARY_MAX_CHARS = 200;

/** 压缩摘要中每条消息的最大字符数（用于 droppedSummary） */
export const SUMMARY_SNIPPET_MAX_CHARS = 200;

/** 压缩摘要中每种角色的最大条目数 */
export const SUMMARY_MAX_ENTRIES_PER_ROLE = 8;

// ─── Agent 循环 ──────────────────────────────────────────

/** Agent 循环安全上限，防止无限循环（当 agent.json 未配置 round_limit 时使用） */
export const MAX_ROUNDS = 200;

/** 默认 Agent 轮次上限（0 = 使用 MAX_ROUNDS 兜底） */
export const DEFAULT_AGENT_ROUND_LIMIT = 0;

/** 默认循环检测阈值 */
export const DEFAULT_LOOP_THRESHOLD = 10;

// ─── 遗留（v1 兼容，新代码请勿使用） ────────────────────────

/** @deprecated v1 遗留，新代码请使用触发阈值常量 */
export const CONTEXT_THRESHOLD_PERCENT = MICRO_TRIGGER_PERCENT;

/** @deprecated v1 遗留，新代码不再按百分比保留 */
export const CONTEXT_KEEP_RECENT_PERCENT = 25;

// ─── 优先级（v1 兼容） ──────────────────────────────────

export interface PriorityConfig {
  neverDrop: "critical" | "important" | "normal";
  dropLast: "critical" | "important" | "normal";
  respectPinned: boolean;
}

/** v1 兼容默认优先级 */
export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  neverDrop: "critical",
  dropLast: "important",
  respectPinned: true,
};
