/**
 * CodeBlock —— cli-highlight 全彩代码气泡。
 * 必须限宽：无限宽时一行长代码会撑破对话区右边框。
 */

import React from "react";
import { Box, Text } from "ink";
import { highlight } from "cli-highlight";
import stringWidth from "string-width";
import { useTheme } from "../../theme/theme-context.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { codeBlockInnerCols, chatBodyCols } from "../../layout/chat-width.js";

function truncatePlain(line: string, maxW: number): string {
  if (maxW <= 1) return "…";
  if (stringWidth(line) <= maxW) return line || " ";
  let used = 0;
  let out = "";
  for (const ch of line) {
    const w = stringWidth(ch) || 1;
    if (used + w > maxW - 1) break;
    out += ch;
    used += w;
  }
  return out + "…";
}

/** 去掉 ANSI 后量宽再截断（高亮行用）—— 简单策略：过长则回退纯文本截断 */
function displayLine(raw: string, highlighted: string | null, maxW: number): string {
  const plain = raw || " ";
  if (stringWidth(plain) <= maxW) {
    return highlighted ?? plain;
  }
  // 高亮后宽度难算，统一用纯文本截断避免撑破边框
  return truncatePlain(plain, maxW);
}

export function CodeBlock({
  code,
  lang,
  maxWidth,
}: {
  code: string;
  lang?: string;
  /** 外框最大宽（含边框）；默认按对话正文列估算 */
  maxWidth?: number;
}) {
  const t = useTheme();
  const term = useTerminalSize();
  const outerW = Math.max(12, maxWidth ?? chatBodyCols(term.cols) - 2);
  const innerW = codeBlockInnerCols(outerW);

  let hl: string | null = null;
  try {
    hl = highlight(code, { language: lang || undefined });
  } catch {
    hl = null;
  }
  const rawLines = code.split("\n");
  const hlLines = hl ? hl.split("\n") : null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={t.mdCodeBlockBorder}
      paddingX={1}
      width={outerW}
      flexShrink={0}
      overflow="hidden"
    >
      {lang ? <Text color={t.dim}>{`‹${lang}›`}</Text> : null}
      {rawLines.map((raw, i) => {
        const shown = displayLine(raw, hlLines?.[i] ?? null, innerW);
        return hlLines && stringWidth(raw) <= innerW ? (
          <Text key={i}>{shown || " "}</Text>
        ) : (
          <Text key={i} color={t.mdCodeBlock}>
            {shown || " "}
          </Text>
        );
      })}
    </Box>
  );
}
