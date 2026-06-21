/**
 * 上下文层常量定义。
 */

// ─── 压缩触发阈值 ──────────────────────────────────────────

/** 微压缩触发阈值：token 达到 maxTokens 的 70% 时进入 compact_zone */
export const MICRO_TRIGGER_PERCENT = 70;

/** 大压缩触发阈值：微压缩后若仍 >= 80%，升级到 summary_zone */
export const SUMMARY_TRIGGER_PERCENT = 80;

/** 归档触发阈值：大压缩后若仍 >= 90%，升级到 archive_zone（极端场景） */
export const ARCHIVE_TRIGGER_PERCENT = 90;

/** 单条消息超过此字符数且未标注 micro_compact，自动参与微压缩 */
export const MICRO_SINGLE_MSG_CHARS = 800;

/** 单条微压缩摘要最大字符数 */
export const MICRO_SUMMARY_MAX_CHARS = 100;

/** 任务摘要每条最大字符数 */
export const SUMMARY_MAX_CHARS = 500;

/** 任务块摘要最大字符数 */
export const TASK_SUMMARY_MAX_CHARS = 200;

/** 压缩摘要中每条消息的最大字符数（用于 droppedSummary） */
export const SUMMARY_SNIPPET_MAX_CHARS = 200;

/** 压缩摘要中每种角色的最大条目数 */
export const SUMMARY_MAX_ENTRIES_PER_ROLE = 8;

// ─── Agent 循环 ──────────────────────────────────────────

/** Agent 循环安全上限，防止无限循环 */
export const MAX_ROUNDS = 50;

/** 默认 Agent 轮次上限（0 = 无限） */
export const DEFAULT_AGENT_ROUND_LIMIT = 0;

/** 默认循环检测阈值 */
export const DEFAULT_LOOP_THRESHOLD = 10;

// ─── 遗留（v1 兼容，新代码请勿使用） ────────────────────────

/** @deprecated v1 遗留，新代码请使用触发阈值常量 */
export const CONTEXT_THRESHOLD_PERCENT = MICRO_TRIGGER_PERCENT;

/** @deprecated v1 遗留，新代码不再按百分比保留 */
export const CONTEXT_KEEP_RECENT_PERCENT = 25;

// ─── 优先级（v1 兼容） ──────────────────────────────────

import type { PriorityConfig } from "./types.js";

/** @deprecated v1 遗留，新压缩算法按 zone 决策，不再依赖优先级 */
export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  neverDrop: "critical",
  dropLast: "important",
  respectPinned: true,
};
