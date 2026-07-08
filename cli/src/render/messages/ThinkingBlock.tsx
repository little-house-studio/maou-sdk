/**
 * ThinkingBlock —— 思考块（设计文档格式）。
 * * think (生成耗时)（灰色，正常收纳，没有就不显示，可以点开展开）
 *
 * 点击展开/收纳内容。thinkingLevel 控制默认展开程度。
 */

import React, { useState, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ThinkingBlock as ThinkingBlockState } from "../../state/types.js";
import { durationStr } from "../../layout/decorators.js";
import { useClickTarget } from "../../input/click-target.js";

export function ThinkingBlock({ block }: { block: ThinkingBlockState }) {
  const t = useTheme();
  const level = useStore((s) => s.thinkingLevel);
  const [open, setOpen] = useState(level >= 3);
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, () => setOpen(o => !o), [block.id, open]);

  if (!block.content) return null;

  const dur = durationStr(block.duration);
  const label = `* think${dur ? ` (${dur})` : ""}`;
  const charCount = block.content.length;

  return (
    <Box ref={ref} flexDirection="column">
      <Text color={t.muted}>{`${label} // ${charCount} 字 ${open ? "▼" : "▶"}`}</Text>
      {open && (
        <Text color={t.muted} wrap="wrap">{block.content}</Text>
      )}
    </Box>
  );
}
