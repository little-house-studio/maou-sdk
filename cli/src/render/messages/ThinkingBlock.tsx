/**
 * ThinkingBlock —— 思考块（嵌在 MsgBody 内，再缩进一层 logo 感）。
 * 行首 * 与 think 元信息对齐工具卡片风格，不侵占外层 logo 列。
 * 正文显示框最多 5 行（流式中看末尾 5 行）。
 */

import React, { useState, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ThinkingBlock as ThinkingBlockState } from "../../state/types.js";
import { durationStr } from "../../layout/decorators.js";
import { useClickTarget } from "../../input/click-target.js";
import { useAnimFrame, spinnerChar, neonRgb } from "../../hooks/useAnimFrame.js";

/** 思考正文可视行数上限 */
const THINK_MAX_LINES = 5;

/** 截成最多 maxLines 行；streaming 时取末尾（最新思考），否则取开头 */
function clipThinkLines(text: string, maxLines: number, tail: boolean): {
  body: string;
  clipped: boolean;
  total: number;
} {
  const lines = text.split("\n");
  const total = lines.length;
  if (total <= maxLines) return { body: text, clipped: false, total };
  if (tail) {
    return {
      body: "…\n" + lines.slice(-maxLines).join("\n"),
      clipped: true,
      total,
    };
  }
  return {
    body: lines.slice(0, maxLines).join("\n") + "\n…",
    clipped: true,
    total,
  };
}

export function ThinkingBlock({ block }: { block: ThinkingBlockState }) {
  const t = useTheme();
  const level = useStore((s) => s.thinkingLevel);
  const [open, setOpen] = useState(level >= 3);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(ref, () => setOpen((o) => !o), [block.id, open]);
  const isHover = useStore((s) => s.hoverId) === cid;
  const streaming = !!block.streaming;
  const frame = useAnimFrame(streaming, 130);

  if (!block.content && !streaming) return null;

  const dur = durationStr(block.duration);
  const charCount = block.content.length;
  const spin = spinnerChar(frame);
  const [r, g, b] = neonRgb(frame * 0.55);
  const pulse = `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  const markColor = isHover ? t.accent : streaming ? pulse : t.muted;

  // 流式：始终露正文但最多 5 行（尾部）；结束后：展开时最多 5 行（头部）
  const showBody = (open || streaming) && !!block.content;
  const clipped = useMemo(
    () => (showBody ? clipThinkLines(block.content, THINK_MAX_LINES, streaming) : null),
    [showBody, block.content, streaming],
  );

  return (
    <Box ref={ref} flexDirection="column">
      {/* 二级标记：正文列内再留 2 列给 *，避免和主 logo 列抢位 */}
      <Box flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color={markColor}>{streaming ? `${spin} ` : "* "}</Text>
        </Box>
        <Text color={markColor}>
          {streaming
            ? `think ${spin}${".".repeat((frame % 3) + 1)} // ${charCount} 字`
            : `think${dur ? ` (${dur})` : ""} // ${charCount} 字 ${open ? "▼" : "▶"}`}
        </Text>
      </Box>
      {showBody && clipped ? (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}><Text>{"  "}</Text></Box>
            <Text color={streaming ? t.fg : t.muted} wrap="wrap">
              {clipped.body}
              {streaming ? (
                <Text color={pulse} bold>{` ${spin}`}</Text>
              ) : null}
            </Text>
          </Box>
          {clipped.clipped && !streaming ? (
            <Box flexDirection="row">
              <Box width={2} flexShrink={0}><Text>{"  "}</Text></Box>
              <Text color={t.dim}>{`… 共 ${clipped.total} 行 · 仅显示 ${THINK_MAX_LINES} 行`}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
