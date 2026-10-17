/**
 * 本次 run 的轮次上限。
 * agent.json.round_limit 优先；0 = 不限轮。
 */

function isUsableRoundLimit(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

export function resolveRunRoundLimit(
  runtimeDefault: number,
  agentJsonLimit: unknown,
): number {
  if (isUsableRoundLimit(agentJsonLimit)) return Math.trunc(agentJsonLimit);
  if (isUsableRoundLimit(runtimeDefault)) return Math.trunc(runtimeDefault);
  return 0;
}

/** 0 表示不限轮。 */
export function isUnlimitedRounds(limit: number): boolean {
  return !(limit > 0);
}

export function shouldContinueRound(roundCount: number, limit: number): boolean {
  return isUnlimitedRounds(limit) || roundCount < limit;
}
