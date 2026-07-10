/**
 * ThinkingBlock —— 思考块（嵌在 MsgBody 内，再缩进一层 logo 感）。
 * 行首 * 与 think 元信息对齐工具卡片风格，不侵占外层 logo 列。
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
  const cid = useClickTarget(ref, () => setOpen((o) => !o), [block.id, open]);
  const isHover = useStore((s) => s.hoverId) === cid;

  if (!block.content) return null;

  const dur = durationStr(block.duration);
  const charCount = block.content.length;

  return (
    <Box ref={ref} flexDirection="column">
      {/* 二级标记：正文列内再留 2 列给 *，避免和主 logo 列抢位 */}
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color={isHover ? t.accent : t.muted}>{"* "}</Text>
        </Box>
        <Text color={isHover ? t.accent : t.muted}>
          {`think${dur ? ` (${dur})` : ""} // ${charCount} 字 ${open ? "▼" : "▶"}`}
        </Text>
      </Box>
      {open && (
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}><Text>{"  "}</Text></Box>
          <Text color={t.muted} wrap="wrap">{block.content}</Text>
        </Box>
      )}
    </Box>
  );
}
