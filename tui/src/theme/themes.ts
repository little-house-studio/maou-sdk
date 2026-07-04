// ── Pi TUI 主题对象 ────────────────────────────────────────────────────
//
// 由 colors.ts (C/fg/bg) + symbols.ts (SYM) 组装出的 Pi 主题：
// symbolTheme / editorTheme / markdownTheme / selectListTheme / toolCardBorder。
// selectListTheme 被 app 与 agent.ts 审批 overlay 共用，故 export。

import type {
  EditorTheme, MarkdownTheme, SymbolTheme, SelectListTheme, BoxBorder,
} from "@oh-my-pi/pi-tui";
import { C, fg } from "./colors.js";
import { SYM } from "./symbols.js";

// ── Markdown 主题（Pi MarkdownTheme） ─────────────────────────────────
export const symbolTheme: SymbolTheme = {
  cursor: SYM.index,
  inputCursor: SYM.index,
  boxRound: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│" },
  boxSharp: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│", teeDown: "┬", teeUp: "┴", teeLeft: "├", teeRight: "┤", cross: "┼" },
  table: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│", teeDown: "┬", teeUp: "┴", teeLeft: "├", teeRight: "┤", cross: "┼" },
  quoteBorder: "│",
  hrChar: "─",
  spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  colorSwatch: "◆",
};

/** SelectList 主题（app 与 driver 审批 overlay 共用）。 */
export const selectListTheme: SelectListTheme = {
  selectedPrefix: fg(C.accent),
  selectedText: fg(C.fg),
  description: fg(C.muted),
  scrollInfo: fg(C.dim),
  noMatch: fg(C.dim),
  symbols: symbolTheme,
};

export const editorTheme: EditorTheme = {
  borderColor: fg(C.border),
  selectList: selectListTheme,
  symbols: symbolTheme,
  editorPaddingX: 1,
  hintStyle: fg(C.muted),
};

export const markdownTheme: MarkdownTheme = {
  heading: fg(C.accent),      // 标题：签名黄绿（最醒目）
  link: fg(C.accent2),        // 链接：电光蓝
  linkUrl: fg(C.dim),         // 链接 URL：暗
  code: fg(C.highlight),      // 行内代码：霓虹黄
  codeBlock: fg(C.accent2),   // 代码块：电光蓝
  codeBlockBorder: fg(C.border),
  quote: fg(C.magenta),       // 引用：霓虹紫
  quoteBorder: fg(C.magenta),
  hr: fg(C.dim),
  listBullet: fg(C.accent),   // 列表项：黄绿
  bold: (t) => `\x1b[1m${t}\x1b[22m`,
  italic: (t) => `\x1b[3m${t}\x1b[23m`,
  strikethrough: (t) => `\x1b[9m${t}\x1b[29m`,
  underline: (t) => `\x1b[4m${t}\x1b[24m`,
  symbols: symbolTheme,
};

// ── 工具卡片 Box 边框 ─────────────────────────────────────────────────
export const toolCardBorder: BoxBorder = {
  chars: {
    topLeft: "┌", topRight: "┐",
    bottomLeft: "└", bottomRight: "┘",
    horizontal: "─", vertical: "│",
  },
  color: fg(C.border),
};
