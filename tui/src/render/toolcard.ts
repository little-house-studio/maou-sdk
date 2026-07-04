// ── 工具卡片渲染 + 边框背景绘制 ───────────────────────────────────────
//
// 折叠：head 行 = 工具名 + 状态 + 参数摘要（单行），有更多内容加 …
// 展开：head + 完整 args + result 12 行 + 折叠提示

import { visibleWidth } from "@oh-my-pi/pi-tui";
import type { Block, UIState } from "../state/types.js";
import { C, fg, bg } from "../theme/colors.js";
import { SYM } from "../theme/symbols.js";
import { symbolTheme } from "../theme/themes.js";
import { trunc } from "./decorators.js";

/** 画工具卡片边框+背景：每行 pad 到 width + bg(C.cardBg) 整行填色 */
export function drawCardFrame(rows: string[], width: number): string[] {
  const borderColor = fg(C.border);
  const h = "─".repeat(Math.max(0, width - 2));
  const bgFn = bg(C.cardBg);
  const padBg = (s: string) => {
    const w = visibleWidth(s);
    return bgFn(s + " ".repeat(Math.max(0, width - w)));
  };
  const result: string[] = [
    padBg(borderColor(`┌${h}┐`)),
  ];
  for (const row of rows) {
    const padded = row + " ".repeat(Math.max(0, width - visibleWidth(row) - 2));
    result.push(padBg(borderColor("│") + padded + borderColor("│")));
  }
  result.push(padBg(borderColor(`└${h}┘`)));
  return result;
}

export function renderToolCard(tc: Extract<Block, { type: "tool" }>, state: UIState, spinnerFrame: number, width: number): string[] {
  const expanded = state.toolsExpanded;
  const status = tc.done
    ? fg(C.dim)(tc.isError ? "✗" : "✓")
    : fg(C.warn)(`${symbolTheme.spinnerFrames[spinnerFrame % symbolTheme.spinnerFrames.length]}…`);
  const name = fg(C.tool)(tc.name);

  // 折叠：head 行 = 工具名 + 状态 + 参数摘要（单行），有更多内容加 …
  if (!expanded) {
    const argsPreview = (tc.args && tc.args !== "{}")
      ? ` ${fg(C.dim)(trunc(tc.args, width - tc.name.length - 8))}`
      : "";
    const hasMore = (tc.result && tc.result.split("\n").filter(l => l.trim()).length > 0);
    const more = hasMore ? ` ${fg(C.dim)("…")}` : "";
    const head = `${SYM.marker} ${name} ${status}${argsPreview}${more}`;
    // 自己画边框+背景（Pi Box bgFn 只填内容区不填边框行）
    return drawCardFrame([head], width);
  }

  // 展开：head + 完整 args + result 12 行 + 折叠提示
  const innerRows: string[] = [`${SYM.marker} ${name} ${status}`];
  if (tc.args && tc.args !== "{}") {
    innerRows.push(`  ${fg(C.dim)(trunc(tc.args, width - 6))}`);
  }
  if (tc.result) {
    const allLines = tc.result.split("\n").filter(l => l.trim().length > 0);
    const resultLines = allLines.slice(0, 12);
    const color = tc.isError ? fg(C.err) : fg(C.ok);
    for (const l of resultLines) {
      innerRows.push(`  ${color(trunc(l, width - 6))}`);
    }
    const total = allLines.length;
    if (total > 12) {
      innerRows.push(`  ${fg(C.dim)(`[+${total - 12}行]`)}`);
    }
  }
  innerRows.push(`  ${fg(C.dim)("[ctrl+o: 折叠]")}`);
  return drawCardFrame(innerRows, width);
}
