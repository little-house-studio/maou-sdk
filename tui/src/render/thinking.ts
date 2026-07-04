// ── 思考折叠块渲染 ─────────────────────────────────────────────────────
//
// streaming 时显示最后 2 行；finalize 后显示首行 + [+N行] 提示。

import type { Block } from "../state/types.js";
import { C, fg } from "../theme/colors.js";
import { SYM } from "../theme/symbols.js";
import { trunc } from "./decorators.js";

export function renderThinking(tb: Extract<Block, { type: "thinking" }>, width: number): string[] {
  const prefix = fg(C.dim)(`${SYM.marker} `);
  const lines = tb.content.split("\n").filter(l => l.length > 0);
  if (lines.length === 0) {
    return [`${prefix}${fg(C.muted)(tb.streaming ? "思考中…" : "[思考]")}`];
  }
  if (tb.streaming) {
    const shown = lines.slice(-2);
    return shown.map(l => `${prefix}${fg(C.muted)(trunc(l, width - 2))}`);
  }
  const first = trunc(lines[0]!, width - 12);
  const more = lines.length > 1 ? ` ${fg(C.dim)(`[+${lines.length - 1}行]`)}` : "";
  return [`${prefix}${fg(C.muted)(first)}${more}`];
}
