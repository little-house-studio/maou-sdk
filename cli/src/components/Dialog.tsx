/** Dialog —— 不透明弹窗（每格填底色，不透底）+ 投影 + 边框 + 标题/页脚 */
import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { currentTheme } from "../theme.js";

export interface Seg { text: string; color?: string; bold?: boolean; dim?: boolean }
export type DialogRow = Seg[];

/** 行：分段着色 + 右侧空格填满（让整行底色连续，覆盖背后内容） */
function Row({ segs, innerW, bg, selected }: { segs: Seg[]; innerW: number; bg: string; selected?: boolean }) {
  const t = currentTheme;
  const rowBg = selected ? t.selectionBg : bg;
  const used = segs.reduce((s, x) => s + stringWidth(x.text), 0);
  const pad = Math.max(0, innerW - used);
  return (
    <Box>
      <Text backgroundColor={bg} color={t.accent}>│ </Text>
      <Text backgroundColor={rowBg}>
        {segs.map((s, j) => (
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
