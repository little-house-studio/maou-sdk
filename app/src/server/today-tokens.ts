/**
 * 本机日历日 token 合计。
 * 读 TokenTracker 日桶：maouRoot/agents/<name>/tokens/YYYY-MM-DD.json。runtime record 写。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TokenTracker } from "@little-house-studio/agent";

export type TodayTokenTotals = {
  date: string;
  inputTokens: number;
  outputTokens: number;
};

/** 与 TokenTracker 日桶文件名相同：本机日历 YYYY-MM-DD */
export function tokenDayKey(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function collectTodayTokenTotals(
  maouRoot: string,
  date?: string | null,
): TodayTokenTotals {
  const day = date?.trim() || tokenDayKey();
  const empty: TodayTokenTotals = { date: day, inputTokens: 0, outputTokens: 0 };
  const agentsDir = join(maouRoot, "agents");
  if (!existsSync(agentsDir)) return empty;
  let names: string[] = [];
  try {
    names = readdirSync(agentsDir);
  } catch {
    return empty;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  for (const name of names) {
    const dir = join(agentsDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const summary = new TokenTracker(maouRoot, name).getDailySummary(day);
    inputTokens += Number(summary.total_input_tokens ?? 0) || 0;
    outputTokens += Number(summary.total_output_tokens ?? 0) || 0;
  }
  return { date: day, inputTokens, outputTokens };
}
