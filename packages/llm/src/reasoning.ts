/**
 * 统一思考强度（Reasoning Level）
 *
 * 对标 pi-ai 的 5 级精细控制：minimal / low / medium / high / xhigh（外加 off）。
 * 以 Anthropic 风格的 thinking budget 为「规范形」(canonical)——各协议适配器都已能消费它
 * （OpenAI→reasoning_effort、Gemini/Vertex→thinkingConfig、Responses/Codex→reasoning.effort）。
 * 也提供到 OpenAI reasoning_effort 的直接映射，供需要时使用。
 */

/** 统一思考级别 */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** 各级别对应的 thinking token 预算（Anthropic 风格规范形） */
export const REASONING_BUDGETS: Record<Exclude<ReasoningLevel, "off">, number> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 32768,
};

/** 取某级别的 token 预算（off→0；custom 覆盖） */
export function reasoningBudget(level: ReasoningLevel, custom?: number): number {
  if (typeof custom === "number" && custom >= 0) return custom;
  return level === "off" ? 0 : REASONING_BUDGETS[level];
}

/**
 * 产出规范形 reasoning_params（写进 preset.reasoning_params 即可，各适配器自动翻译）。
 * @param level 统一级别
 * @param opts.budgetTokens 自定义 token 预算（覆盖级别默认值）
 */
export function reasoningParamsFor(
  level: ReasoningLevel,
  opts?: { budgetTokens?: number },
): Record<string, unknown> {
  if (level === "off") return { thinking: { type: "disabled" } };
  return { thinking: { type: "enabled", budget_tokens: reasoningBudget(level, opts?.budgetTokens) } };
}

/**
 * 统一级别 → OpenAI reasoning_effort。
 * OpenAI 仅支持 minimal/low/medium/high；xhigh 收敛到 high；off→null（不开思考）。
 */
export function toOpenAIReasoningEffort(level: ReasoningLevel): string | null {
  if (level === "off") return null;
  if (level === "xhigh") return "high";
  return level;
}

/** OpenAI reasoning_effort / token 预算 → 统一级别（用于回显/归一） */
export function reasoningLevelFromBudget(budget: number): ReasoningLevel {
  if (budget <= 0) return "off";
  if (budget <= 1024) return "minimal";
  if (budget <= 2048) return "low";
  if (budget <= 8192) return "medium";
  if (budget <= 16384) return "high";
  return "xhigh";
}
