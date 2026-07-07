/**
 * ThinkingBlock —— 思考块（新格式：* think (耗时)，灰色，收纳可展开）。
 * thinkingLevel: 0 全收 / 1-2 摘要 / 3-4 前 500 字 / 5 全展。
 */

import React from "react";
import { Box } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ThinkingBlock as ThinkingBlockState } from "../../state/types.js";
import { SelectableText } from "../SelectableText.js";
import { durationStr } from "../../layout/decorators.js";

export function ThinkingBlock({ block }: { block: ThinkingBlockState }) {
  const t = useTheme();
  const level = useStore((s) => s.thinkingLevel);
  if (!block.content) return null;

  const dur = durationStr(block.duration);
  const label = `* think${dur ? ` (${dur})` : ""}`;
  const charCount = block.content.length;

  // 0 级全收
  if (level === 0) {
    return <SelectableText color={t.muted}>{`  ${label} // ${charCount} 字`}</SelectableText>;
  }
  // 1-2 级摘要
  if (level <= 2) {
    return (
      <Box flexDirection="column">
        <SelectableText color={t.muted}>{`  ${label} // ${charCount} 字`}</SelectableText>
      </Box>
    );
  }
  // 3-4 级：前 500 字
  const shown = level >= 5 ? block.content : block.content.slice(0, 500);
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <SelectableText color={t.info}>{`${label} // ${charCount} 字${level < 5 && charCount > 500 ? "（前 500）" : ""}`}</SelectableText>
      <SelectableText color={t.muted} wrap="wrap">{shown}</SelectableText>
    </Box>
  );
}
