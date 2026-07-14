/**
 * 对话区可用宽度 —— 外层 Layout 对 Chat 用了 borderStyle="single"，
 * 左右边框各占 1 列，内容区 = term.cols - 2。
 * 所有消息/工具卡/代码块必须 ≤ 此宽，否则右边框会被撑裂。
 */

/** 对话区内层内容宽（含 logo 列） */
export function chatInnerCols(termCols: number): number {
  return Math.max(16, termCols - 2);
}

/** MsgBody 正文列宽（扣掉 logo 列 LOGO_W=2） */
export function chatBodyCols(termCols: number, logoW = 2): number {
  return Math.max(12, chatInnerCols(termCols) - logoW);
}

/** 工具卡外宽（正文列内再留一点余量，避免 +border 溢出） */
export function toolCardOuterCols(termCols: number): number {
  // MsgBody 已空 logo；卡片自带 single border（Yoga 常算进 width）
  return Math.max(16, chatBodyCols(termCols) - 1);
}

/** 代码块可用内容列（扣 round 边框 2 + paddingX 1*2） */
export function codeBlockInnerCols(maxOuter: number): number {
  return Math.max(8, maxOuter - 4);
}

/** 按视觉宽截断（CJK=2），超出加 … */
export function truncateVisual(text: string, maxW: number): string {
  if (maxW <= 0) return "";
  // 动态 import 避免循环；此文件保持轻量，用简单计宽
  let used = 0;
  let out = "";
  for (const ch of text) {
    // CJK / 全角粗略：非 ASCII 多数字符宽 2
    const code = ch.codePointAt(0) ?? 0;
    const w =
      code <= 0x1f ? 0
      : code <= 0x7e ? 1
      : code >= 0x1100 && (
          code <= 0x115f ||
          code === 0x2329 || code === 0x232a ||
          (code >= 0x2e80 && code <= 0xa4cf) ||
          (code >= 0xac00 && code <= 0xd7a3) ||
          (code >= 0xf900 && code <= 0xfaff) ||
          (code >= 0xfe10 && code <= 0xfe19) ||
          (code >= 0xfe30 && code <= 0xfe6f) ||
          (code >= 0xff00 && code <= 0xff60) ||
          (code >= 0xffe0 && code <= 0xffe6) ||
          (code >= 0x20000 && code <= 0x2fffd) ||
          (code >= 0x30000 && code <= 0x3fffd)
        ) ? 2
      : 1;
    if (used + w > maxW) {
      // 尽量塞进省略号
      while (out.length && used > maxW - 1) {
        const last = out[out.length - 1]!;
        const lw = (last.codePointAt(0) ?? 0) > 0x7e ? 2 : 1;
        out = out.slice(0, -1);
        used -= lw;
      }
      return out + (maxW >= 1 ? "…" : "");
    }
    out += ch;
    used += w;
  }
  return out;
}
