/** Dialog —— 不透明弹窗（每格填底色，不透底）+ 投影 + 边框 + 标题/页脚 */
import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { currentTheme } from "../theme.js";

export interface Seg { text: string; color?: string; bold?: boolean; dim?: boolean }
export type DialogRow = Seg[];

/** 按显示宽度截断文本（CJK 字符算 2 列） */
function truncateToWidth(text: string, maxW: number): string {
  let w = 0, result = "";
  for (const ch of text) {
    const cw = stringWidth(ch);
    if (w + cw > maxW) break;
    result += ch;
    w += cw;
  }
  return result;
}

/** 按显示宽度右侧填充空格（替代 padEnd，避免 CJK 字符导致宽度不一致） */
export function padEndWidth(text: string, width: number): string {
  const sw = stringWidth(text);
  return sw >= width ? text : text + " ".repeat(width - sw);
}

/** 行：分段着色 + 右侧空格填满（让整行底色连续，覆盖背后内容）
 *  内容溢出时按 seg 顺序截断，保证右边框对齐 */
function Row({ segs, innerW, bg, selected }: { segs: Seg[]; innerW: number; bg: string; selected?: boolean }) {
  const t = currentTheme;
  const rowBg = selected ? t.selectionBg : bg;

  // 截断溢出的 seg：按顺序分配 innerW 宽度，超出部分截断或清空
  let remaining = innerW;
  const displaySegs = segs.map((s) => {
    const sw = stringWidth(s.text);
    if (remaining <= 0) return { ...s, text: "" };
    if (sw > remaining) {
      const truncated = { ...s, text: truncateToWidth(s.text, remaining) };
      remaining = 0;
      return truncated;
    }
    remaining -= sw;
    return s;
  });
  const used = displaySegs.reduce((s, x) => s + stringWidth(x.text), 0);
  const pad = Math.max(0, innerW - used);

  return (
    <Box>
      <Text backgroundColor={bg} color={t.accent}>│ </Text>
      <Text backgroundColor={rowBg}>
        {displaySegs.map((s, j) => (
          <Text key={j} backgroundColor={rowBg} color={s.color ?? t.overlayFg} bold={s.bold} dimColor={s.dim}>{s.text}</Text>
        ))}
        <Text backgroundColor={rowBg}>{" ".repeat(pad)}</Text>
      </Text>
      <Text backgroundColor={bg} color={t.accent}> │</Text>
    </Box>
  );
}

/**
 * 不透明弹窗。rows 为分段着色的行；selected 高亮某行；footer 显示在底部（dim）。
 * 关键：Ink 的 Box 不支持 backgroundColor，所以靠"每格都是带底色的 Text"来不透底。
 */
export function Dialog({
  title, footer, rows, width = 50, selected, marginLeft = 4, marginTop = 2, shadow = true,
}: {
  title?: string;
  footer?: string;
  rows: DialogRow[];
  width?: number;
  selected?: number;
  marginLeft?: number;
  marginTop?: number;
  shadow?: boolean;
}) {
  const t = currentTheme;
  const bg = t.overlayBg;
  const innerW = width - 4; // 2 边框 + 左右各 1 空格
  const titleStr = title ? ` ${title} ` : "";
  const topFill = Math.max(0, width - 2 - stringWidth(titleStr));
  const tl = Math.floor(topFill / 2), tr = topFill - tl;
  const bodyHeight = rows.length + (footer !== undefined ? 1 : 0) + 2; // 边框上下

  return (
    <>
      {shadow && (
        <Box position="absolute" marginLeft={marginLeft + 2} marginTop={marginTop + 1} flexDirection="column">
          {Array.from({ length: bodyHeight }, (_, i) => (
            <Text key={i} backgroundColor={t.overlayShadow}>{" ".repeat(width)}</Text>
          ))}
        </Box>
      )}
      <Box position="absolute" marginLeft={marginLeft} marginTop={marginTop} flexDirection="column">
        <Text backgroundColor={bg} color={t.accent} bold>{"╭" + "─".repeat(tl) + titleStr + "─".repeat(tr) + "╮"}</Text>
        {rows.map((r, i) => <Row key={i} segs={r} innerW={innerW} bg={bg} selected={selected === i} />)}
        {footer !== undefined && <Row segs={[{ text: footer, color: t.dim, dim: true }]} innerW={innerW} bg={bg} />}
        <Text backgroundColor={bg} color={t.accent}>{"╰" + "─".repeat(width - 2) + "╯"}</Text>
      </Box>
    </>
  );
}
