/**
 * CLI 默认值 —— 避免 "coding" / "main" 等 fallback 散落。
 *
 * 行为保持与历史一致：
 *   - 绝大多数空 agent 回退 "coding"
 *   - 审批请求 ctx 缺省时曾用 "main"（tools 侧偶发省略 agentName）
 */

/** store / UI / policy 写盘时的默认 agent */
export const DEFAULT_AGENT_NAME = "coding";

/**
 * 终端审批 UI 在 tools 未带 agentName 时的历史 fallback。
 * 与 DEFAULT_AGENT_NAME 刻意分开，避免悄悄改写 policy 归属。
 */
export const APPROVAL_AGENT_FALLBACK = "main";

/** 可回退到 coding-agent 内置 prompt 模板的 agent 名 */
export const CODING_TEMPLATE_AGENT_NAMES = new Set(["coding", "main"]);

export function resolveAgentName(
  name: string | null | undefined,
  fallback: string = DEFAULT_AGENT_NAME,
): string {
  const n = (name ?? "").trim();
  return n || fallback;
}

export function usesCodingTemplate(agentName: string): boolean {
  return CODING_TEMPLATE_AGENT_NAMES.has(agentName);
}
