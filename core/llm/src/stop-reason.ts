/**
 * stop-reason —— 跨平台 stop_reason / finish_reason 统一映射
 *
 * 各 LLM 平台用不同的字段名和值表达"模型为什么停止生成"：
 *   - OpenAI Chat:    finish_reason = "stop" | "tool_calls" | "length" | "content_filter"
 *   - OpenAI Responses: status = "completed" | "incomplete" | "in_progress"
 *   - Anthropic:      stop_reason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal"
 *   - Google Gemini:  finishReason = "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "OTHER"
 *   - Mistral:        finish_reason = "stop" | "tool_calls" | "length" | "error"（兼容 OpenAI）
 *   - Bedrock:         stopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
 *
 * 本模块提供：
 *   - `normalizeStopReason(raw, protocol?)`：把任意平台的原始值映射为统一 StopReason
 *   - `shouldContinueLoop(reason)`：判断 Agent loop 是否应该继续
 */

import type { StopReason } from "./stream.js";

/** 平台原始 stop_reason / finish_reason → 统一 StopReason 的映射表 */
const STOP_REASON_MAP: Record<string, StopReason> = {
  // ── OpenAI Chat Completions ──
  stop: "stop",
  tool_calls: "toolUse",
  tool_call: "toolUse",
  length: "length",
  content_filter: "refusal",

  // ── OpenAI Responses API ──
  completed: "stop",
  incomplete: "length",

  // ── Anthropic ──
  end_turn: "stop",
  tool_use: "toolUse",
  max_tokens: "length",
  stop_sequence: "stopSequence",
  pause_turn: "pauseTurn",
  refusal: "refusal",

  // ── Google Gemini ──
  // Gemini 用大写，但 lowercase 后与 OpenAI 的 stop/max_tokens 冲突
  // 所以用原始大小写做 key，normalizeStopReason 会先 toLowerCase
  // STOP → stop（已在上面）, MAX_TOKENS → length, SAFETY → safety, RECITATION → recitation
  // 这些大写 key 在 toLowerCase 后会匹配到 OpenAI 的同名小写 key
  // 所以无需重复添加，Gemini 的值经过 toLowerCase 后自动命中

  // ── Bedrock（Anthropic 子集，值与 Anthropic 相同）──
  // end_turn / tool_use / max_tokens / stop_sequence 已在 Anthropic 区覆盖

  // ── Mistral（OpenAI 兼容，值与 OpenAI 相同）──
  // stop / tool_calls / length 已在 OpenAI 区覆盖
  // Mistral 独有 error:
  error: "error",

  // ── Gemini 独有的大写值（toLowerCase 后与 OpenAI 不冲突的）──
  safety: "safety",
  recitation: "recitation",
  other: "stop",
};

/**
 * 把任意平台的原始 stop_reason / finish_reason 字符串映射为统一 StopReason。
 *
 * @param raw 平台返回的原始值（如 "end_turn", "tool_calls", "STOP" 等）
 * @param fallback 找不到映射时的默认值（默认 "stop"）
 * @returns 统一的 StopReason
 */
export function normalizeStopReason(
  raw: string | null | undefined,
  fallback: StopReason = "stop",
): StopReason {
  if (!raw) return fallback;
  const key = raw.trim().toLowerCase();
  return STOP_REASON_MAP[key] ?? fallback;
}

/**
 * 根据 Agent loop 的上下文判断是否应该继续循环。
 *
 * 继续循环的条件（满足任一）：
 *   - toolUse：模型要调工具 → 执行工具后继续
 *   - pauseTurn：扩展思考暂停 → 恢复后继续
 *   - length：输出被 max_tokens 截断 → 续写
 *
 * 停止循环的条件：
 *   - stop：模型自然完成
 *   - stopSequence：命中自定义停止序列
 *   - refusal：模型拒绝/安全拦截
 *   - safety：安全策略拦截
 *   - recitation：著作权保护拦截
 *   - error：请求出错
 *   - aborted：用户中断
 *
 * @param reason 统一的 StopReason
 * @returns true = 继续 loop，false = 停止 loop
 */
export function shouldContinueLoop(reason: StopReason): boolean {
  switch (reason) {
    case "toolUse":
    case "pauseTurn":
    case "length":
      return true;
    case "stop":
    case "stopSequence":
    case "refusal":
    case "safety":
    case "recitation":
    case "error":
    case "aborted":
      return false;
  }
}

/**
 * 判断该 stop reason 是否需要续写（max_tokens 截断后让模型继续生成）。
 *
 * 只有 `length`（max_tokens 截断）需要续写。
 * `pauseTurn` 需要恢复但不属于"续写"（恢复是重新发请求，不是追加内容）。
 */
export function needsContinuation(reason: StopReason): boolean {
  return reason === "length";
}

/**
 * 判断该 stop reason 是否表示模型被安全策略拦截（不可重试）。
 */
export function isSafetyBlock(reason: StopReason): boolean {
  return reason === "refusal" || reason === "safety" || reason === "recitation";
}

/**
 * 判断该 stop reason 是否表示模型调用了工具（需要执行工具后继续 loop）。
 */
export function isToolUse(reason: StopReason): boolean {
  return reason === "toolUse";
}
