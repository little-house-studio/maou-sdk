/** 输入框 —— 点击定位光标（宽字符感知）+ 拖选高亮 */
import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { currentTheme } from "../theme.js";

export interface InputBoxProps {
  value: string;
  cursor: number; // 字符索引
  focused: boolean;
  placeholder?: string;
  prompt?: string;
  /** 选区字符索引区间 [selStart, selEnd)（拖选时高亮） */
  selStart?: number;
  selEnd?: number;
}

/**
 * 由"列偏移"算出对应字符索引（宽字符=2列）。
 * 供鼠标点击定位：点击列 cx → 返回最接近的字符索引。
 */
export function colToCharIndex(text: string, col: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const cw = stringWidth(text[i]!);
    if (w + cw > col) return i;
    w += cw;
  }
  return text.length;
}

export function InputBox({ value, cursor, focused, placeholder = "输入消息…", prompt = "❯", selStart, selEnd }: InputBoxProps) {
  const t = currentTheme;
  const s = Math.min(selStart ?? cursor, selEnd ?? cursor);
  const e = Math.max(selStart ?? cursor, selEnd ?? cursor);
  const hasSel = e > s;
  const chars = [...value];
  return (
    <Box borderStyle="round" borderColor={focused ? t.accent : t.border} paddingX={1}>
      <Text color={t.accent} bold>{prompt} </Text>
      {chars.length === 0 && !focused ? (
        <Text color={t.dim}>{placeholder}</Text>
      ) : (
        <Text>
          {chars.map((ch, i) => {
            const inSel = hasSel && i >= s && i < e;
            const isCursor = focused && i === cursor && !hasSel;
            if (isCursor) return <Text key={i} backgroundColor={t.accent} color={t.bg}>{ch}</Text>;
            if (inSel) return <Text key={i} backgroundColor={t.selectionBg} color={t.overlayFg}>{ch}</Text>;
            return <Text key={i} color={t.fg}>{ch}</Text>;
          })}
          {focused && cursor >= chars.length && !hasSel && <Text backgroundColor={t.accent} color={t.bg}> </Text>}
        </Text>
      )}
    </Box>
  );
}
