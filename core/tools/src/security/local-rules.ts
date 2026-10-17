/**
 * 本地规则：DCG 现有 pack 仍 allow 的缺口。
 *
 * 调用点：gate.assessCommandSecurity，仅 DCG allow 之后。
 */

import type { SecurityTier } from "./types.js";

export interface LocalRuleHit {
  id: string;
  tier: SecurityTier;
  reason: string;
}

const RULES: Array<{
  id: string;
  tier: SecurityTier;
  re: RegExp;
  reason: string;
}> = [
  {
    id: "local.secret:curl-auth-header-hardcoded",
    tier: "dangerous",
    re: /\bcurl\b[^\n]*(-H|--header)\s*['"][^'"]*(Authorization|api[_-]?key|token)\s*:/i,
    reason: "命令行明文携带 Authorization/API Key，易进日志与历史",
  },
];

/** 检查本地规则。按数组顺序，首中即返回。 */
export function checkLocalSecurityRules(command: string): LocalRuleHit | null {
  const cmd = command || "";
  for (const r of RULES) {
    if (r.re.test(cmd)) {
      return { id: r.id, tier: r.tier, reason: r.reason };
    }
  }
  return null;
}

export function listLocalSecurityRules(): Array<{ id: string; tier: SecurityTier; reason: string }> {
  return RULES.map(({ id, tier, reason }) => ({ id, tier, reason }));
}
