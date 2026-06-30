/** 输入框 —— 多行自适应 + 点击定位光标（宽字符感知）+ 拖选高亮
 *  - 默认一行，内容含 \n 时自适应多行高度
 *  - 光标跨行定位（行内列偏移 → 字符索引）
 */
import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { currentTheme } from "../theme.js";

export interface InputBoxProps {
  value: string;
  cursor: number; // 字符索引（跨行）
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

  // 按 \n 分行，记录每行的字符范围 [lineStart, lineEnd)
  const lines: { text: string; start: number; end: number }[] = [];
  let pos = 0;
  for (const line of value.split("\n")) {
    lines.push({ text: line, start: pos, end: pos + line.length });
    pos += line.length + 1; // +1 for \n
  }
  if (lines.length === 0) lines.push({ text: "", start: 0, end: 0 });

  return (
    <Box flexDirection="column" paddingX={0}>
      {/* CC 风格：无边框，> 提示符，自适应高度 */}
      {lines.length === 1 && lines[0]!.text.length === 0 && !focused ? (
        <Box><Text color={focused ? t.accent : t.dim} bold>{prompt} </Text><Text color={t.dim}>{placeholder}</Text></Box>
      ) : (
        lines.map((line, lineIdx) => {
          const chars = [...line.text];
          const isCursorLine = focused && cursor >= line.start && cursor <= line.end;
          return (
            <Box key={lineIdx}>
              {lineIdx === 0 ? (
                <Text color={t.accent} bold>{prompt} </Text>
              ) : (
                <Text color={t.dim}>  </Text>
              )}
              {chars.length === 0 && isCursorLine && !hasSel ? (
                <Text inverse bold> </Text>
              ) : (
                <Text>
                  {chars.map((ch, i) => {
                    const absIdx = line.start + i;
                    const inSel = hasSel && absIdx >= s && absIdx < e;
                    const isCursor = focused && absIdx === cursor && !hasSel;
                    if (isCursor) return <Text key={i} inverse bold>{ch}</Text>;
                    if (inSel) return <Text key={i} backgroundColor={t.selectionBg} color={t.overlayFg}>{ch}</Text>;
                    return <Text key={i} color={t.fg}>{ch}</Text>;
                  })}
                  {isCursorLine && cursor >= line.end && !hasSel && <Text inverse bold> </Text>}
                </Text>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}
