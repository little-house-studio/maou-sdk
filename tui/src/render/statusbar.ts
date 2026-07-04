// ── 状态栏：单行截断（Pi TruncatedText）──────────────────────────────
//
// 时码/信道/agent名/思考级/token条/sparkline/model 的浓缩单行版本。

import { TruncatedText } from "@oh-my-pi/pi-tui";
import type { UIState } from "../state/types.js";
import type { AgentDriver } from "../agent.js";
import { C, fg } from "../theme/colors.js";
import { compact } from "./decorators.js";

export function renderStatusBar(state: UIState, driver: AgentDriver, width: number): string[] {
  const s = state;
  const mode = fg(C.accent)(driver.getApprovalMode());
  const currentTokens = s.currentRoundUsage.input + s.currentRoundUsage.output;
  const lastRound = s.rounds[s.rounds.length - 1];
  const ctxTokens = lastRound ? (lastRound.total ?? (lastRound.input + lastRound.output)) : currentTokens;
  const ctxPct = s.maxContext > 0 ? Math.min(1, ctxTokens / s.maxContext) : 0;
  const model = fg(C.muted)(`${s.provider}/${s.model || "?"}`);
  const pct = fg(C.dim)(`${Math.round(ctxPct * 100)}%`);
  // 平均缓存率：sum(cacheRead)/sum(cacheRead+input) 合并计算（非 mean-of-rates）。
  let cacheSeg = "";
  if (s.cacheHistory.length > 0) {
    const sumCache = s.cacheHistory.reduce((a, c) => a + (c.cacheRead ?? 0), 0);
    const sumInput = s.cacheHistory.reduce((a, c) => a + (c.input ?? 0), 0);
    const rate = sumInput > 0 ? sumCache / sumInput : 0;
    cacheSeg = ` ${fg(C.dim)("·")} ${fg(C.cache)(`c${Math.round(rate * 100)}%`)}`;
  }
  // 前面加空格对齐输入框 paddingX=1
  const text = ` ${mode} ${fg(C.dim)("·")} ${model} ${fg(C.dim)("·")} ${compact(ctxTokens)}/${compact(s.maxContext)} ${pct}${cacheSeg}`;
  return [...new TruncatedText(text, 0, 0).render(width)];
}
