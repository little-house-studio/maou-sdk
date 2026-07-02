/**
 * useThinkingCycle —— Shift+Tab 6 级思考级别 clamp 循环。
 * off(0) → minimal(1) → low(2) → medium(3) → high(4) → xhigh(5) → off(0)
 *
 * Shift+Tab 由 app.tsx useCleanInput 捕获调 store.setThinking。
 */

export const THINKING_NAMES = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

/** thinkingLevel → 模型 reasoning effort 映射（send 时注入 preset） */
export function thinkingToEffort(level: number): "none" | "low" | "medium" | "high" {
  if (level === 0) return "none";
  if (level <= 2) return "low";
  if (level <= 4) return "medium";
  return "high";
}
