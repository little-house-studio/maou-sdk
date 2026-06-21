/** 输入框 —— 支持点击定位光标到字符位置（宽字符感知） */
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

export function InputBox({ value, cursor, focused, placeholder = "输入消息…", prompt = "❯" }: InputBoxProps) {
  const t = currentTheme;
  const before = value.slice(0, cursor);
  const at = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);
  return (
    <Box borderStyle="round" borderColor={focused ? t.accent : t.border} paddingX={1}>
      <Text color={t.accent} bold>{prompt} </Text>
      {value.length === 0 && !focused ? (
        <Text color={t.dim}>{placeholder}</Text>
      ) : (
        <Text>
          <Text color={t.fg}>{before}</Text>
          {focused ? <Text backgroundColor={t.accent} color={t.bg}>{at}</Text> : <Text color={t.fg}>{at === " " ? "" : at}</Text>}
          <Text color={t.fg}>{after}</Text>
        </Text>
      )}
    </Box>
  );
}
