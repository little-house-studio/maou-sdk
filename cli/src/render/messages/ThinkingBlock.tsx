/**
 * ThinkingBlock —— 思考块折叠（6 级显示）。
 * thinkingLevel: 0 全收 / 1-2 只显摘要 / 3-4 显前 500 字 / 5 全展。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ThinkingBlock as ThinkingBlockState } from "../../state/types.js";
import { SYMBOLS } from "../../theme/tokens.js";

const SPIN = SYMBOLS.spinner;

export function ThinkingBlock({ block }: { block: ThinkingBlockState }) {
  const t = useTheme();
  const level = useStore((s) => s.thinkingLevel);
  if (!block.content) return null;

  const streamingMark = block.streaming ? SPIN[0]! : "✓";
  const label = `${streamingMark} thinking`;
  const charCount = block.content.length;

  // 0 级全收（只显一行摘要）
  if (level === 0) {
    return (
      <Text color={t.muted}>  {label} // {charCount} 字</Text>
    );
  }
  // 1-2 级：摘要 + 字数
  if (level <= 2) {
    return (
      <Box flexDirection="column">
        <Text color={t.muted}>  {label} // {charCount} 字</Text>
      </Box>
    );
  }
  // 3-4 级：前 500 字
  const shown = level >= 5 ? block.content : block.content.slice(0, 500);
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color={t.info}>{label} // {charCount} 字{level < 5 && charCount > 500 ? "（前 500）" : ""}</Text>
      <Text color={t.muted} wrap="wrap">{shown}</Text>
    </Box>
  );
}
