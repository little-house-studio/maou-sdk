/**
 * 思考内容回灌上下文策略
 *
 * 三种模式：
 * - never: 永不把思考写入后续 LLM 上下文
 * - first_round: 仅每次 agent loop 的第一回合思考写入上下文（默认）
 * - always: 每一回合的思考都写入上下文
 *
 * 策略在 **写入 session 时** 判定（roundCount === 0 即 loop 首回合）；
 * 已写入的 reasoningContent 会在 buildMessages / sessionToMaouMessage 时注入。
 */

/** 思考回灌上下文模式 */
export type ThinkingContextMode = "never" | "first_round" | "always";

/** 默认：仅 loop 首回合 */
export const DEFAULT_THINKING_CONTEXT_MODE: ThinkingContextMode = "first_round";

const VALID_MODES = new Set<ThinkingContextMode>(["never", "first_round", "always"]);

/**
 * 解析配置值（agent.json thinking_context_mode / RunOptions）。
 * 非法或缺失 → 默认 first_round。
 */
export function parseThinkingContextMode(raw: unknown): ThinkingContextMode {
  if (typeof raw === "string" && VALID_MODES.has(raw as ThinkingContextMode)) {
    return raw as ThinkingContextMode;
  }
  return DEFAULT_THINKING_CONTEXT_MODE;
}

/**
 * 本回合是否应把思考写入 session（供后续上下文消费）。
 *
 * @param mode 策略
 * @param roundCount agent loop 内已完成的回合数（0 = 本 run 第一回合）
 */
export function shouldStoreThinkingInContext(
  mode: ThinkingContextMode,
  roundCount: number,
): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  // first_round
  return roundCount === 0;
}

/**
 * 把思考文本包成统一标签（跨厂商可安全当 assistant 文本）。
 */
export function wrapThinking(thinking: string): string {
  const t = thinking.trim();
  return t ? `<thinking>\n${t}\n</thinking>` : "";
}

/**
 * 若有 reasoning，拼到正文前供 LLM 历史使用；展示用正文保持纯 content。
 */
export function contentWithThinkingForLlm(
  content: string,
  reasoningContent?: string | null,
): string {
  const reasoning = typeof reasoningContent === "string" ? reasoningContent.trim() : "";
  if (!reasoning) return content ?? "";
  const wrapped = wrapThinking(reasoning);
  const body = content ?? "";
  return body ? `${wrapped}\n\n${body}` : wrapped;
}
