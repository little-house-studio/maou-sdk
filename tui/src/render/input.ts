// ── 输入框：Pi Editor（直角框 + 灰底 + 空 placeholder） ────────────
//
// 流式事件状态显示在输入框顶边框（oh-my-pi 风格，替代独立事件块）。
// 空输入时：加灰底背景 + placeholder 提示文字。
//
// 注意：此函数有副作用——调用 editor.setTopBorder() 更新顶边框文本，
// 然后 editor.render() 产出行。editor 由 App 持有并传入。

import { Editor, visibleWidth } from "@oh-my-pi/pi-tui";
import type { UIState } from "../state/types.js";
import { C, fg, bg } from "../theme/colors.js";
import { symbolTheme } from "../theme/themes.js";
import { compact } from "./decorators.js";

export function renderInput(
  editor: Editor,
  state: UIState,
  spinnerFrame: number,
  width: number,
  _height: number,
): string[] {
  void _height;
  // 流式事件状态：显示在输入框顶边框（oh-my-pi 风格，替代独立事件块）
  const modeLabel: Record<string, string> = {
    thinking: "思考中",
    generating: "生成中",
    tool_pending:  `工具 ${state.eventBlock.detail ?? ""}`,
    error: "错误",
    idle: "待命",
  };
  const eb = state.eventBlock;
  const isActive = state.streaming || eb.mode !== "idle";
  const spinner = isActive ? symbolTheme.spinnerFrames[spinnerFrame % symbolTheme.spinnerFrames.length] : "";
  const modeColor = eb.mode === "error" ? fg(C.err)
    : eb.mode === "tool_pending" ? fg(C.warn)
    : eb.mode === "thinking" ? fg(C.info)
    : eb.mode === "generating" ? fg(C.accent)
    : fg(C.dim);
  // 有 detail 时优先显示 detail（如 "API error · Retrying in 4s · attempt 1/15"）
  const label = eb.detail || modeLabel[eb.mode] || "处理中";
  const modeText = isActive ? `${spinner}${label}` : "";
  const tokenText = isActive ? `${fg(C.muted)(`${compact(eb.upTokens)}↑ ${compact(eb.downTokens)}↓`)}` : "";
  const topText = [modeText, tokenText].filter(Boolean).join("  ");
  if (topText) {
    try { editor.setTopBorder({ content: topText, width: visibleWidth(topText) }); }
    catch { /* 忽略 */ }
  } else {
    try { editor.setTopBorder(undefined); } catch { /* 忽略 */ }
  }
  const rows = [...editor.render(width)];
  // 空输入时：加灰底背景 + placeholder 提示文字
  const isEmpty = editor.getText().length === 0;
  if (isEmpty) {
    const placeholder = fg(C.dim)("input [Alt+Enter 换行 / Enter 发送]");
    const bgFn = bg(C.inputBg);
    // 给每行加背景色，底行在光标后加 placeholder
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i]!;
      const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
      rows[i] = bgFn(padded);
    }
    // 底行（光标行）追加 placeholder
    const last = rows.length - 1;
    if (last >= 0) {
      rows[last] = rows[last]!.replace(/\x1b\[0m$/, "") + placeholder + "\x1b[0m";
    }
  }
  return rows;
}
