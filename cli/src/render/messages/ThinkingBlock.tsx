/**
 * ThinkingBlock —— 思考块（嵌在 MsgBody 内，再缩进一层 logo 感）。
 * 行首 * 与 think 元信息对齐工具卡片风格，不侵占外层 logo 列。
 *
 * 流式时正文 **固定 THINK_MAX_LINES 可视行**（尾部窗口 + 顶部垫空），
 * 避免 wrap / 省略号 / 动画字符导致高度上下跳。
 */

import React, { useState, useRef, useMemo, useEffect } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ThinkingBlock as ThinkingBlockState } from "../../state/types.js";
import { durationStr } from "../../layout/decorators.js";
import { useClickTarget } from "../../input/click-target.js";
import { useAnimFrame, spinnerChar, neonRgb } from "../../hooks/useAnimFrame.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

/** 思考正文可视行数上限（流式固定占位，杜绝高度浮动） */
const THINK_MAX_LINES = 5;

/** 按显示列宽折行（与 Ratatui wrap_str 同语义） */
function wrapVisualLines(text: string, width: number): string[] {
  const cols = Math.max(8, width);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.length === 0) {
      out.push("");
      continue;
    }
    let cur = "";
    let w = 0;
    for (const ch of para) {
      const cw = stringWidth(ch) || 1;
      if (w + cw > cols && cur) {
        out.push(cur);
        cur = ch;
        w = cw;
      } else {
        cur += ch;
        w += cw;
      }
    }
    if (cur) out.push(cur);
  }
  return out.length > 0 ? out : [""];
}

/**
 * 取最多 maxLines 条可视行。
 * - streaming：永远返回 **正好** maxLines 行（不足垫空行在顶部，溢出取尾部）
 * - idle 展开：最多 maxLines，不足不垫（短内容不必撑高）
 */
function stableThinkLines(
  text: string,
  maxLines: number,
  bodyCols: number,
  streaming: boolean,
): { lines: string[]; clipped: boolean; total: number } {
  const visual = wrapVisualLines(text || "", bodyCols);
  const total = visual.length;
  if (streaming) {
    let slice: string[];
    if (total <= maxLines) {
      // 顶部垫空，新内容从底部「长」上来，行数恒定
      slice = [
        ...Array(maxLines - total).fill(""),
        ...visual,
      ];
    } else {
      slice = visual.slice(-maxLines);
    }
    return { lines: slice, clipped: total > maxLines, total };
  }
  // 非流式：头部截断
  if (total <= maxLines) {
    return { lines: visual, clipped: false, total };
  }
  return {
    lines: visual.slice(0, maxLines),
    clipped: true,
    total,
  };
}

/** 固定 3 列宽的省略动画，避免 header 宽度抖动引发外层 reflow */
function dotsAnim(frame: number): string {
  const n = (frame % 3) + 1;
  return ".".repeat(n) + " ".repeat(3 - n);
}

export function ThinkingBlock({ block }: { block: ThinkingBlockState }) {
  const t = useTheme();
  // 默认收起：流式中自动展开看过程；结束后自动收成一行标识（可再点开）
  const [open, setOpen] = useState(false);
  const userTouched = useRef(false);
  const wasStreaming = useRef(!!block.streaming);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(
    ref,
    () => {
      userTouched.current = true;
      setOpen((o) => !o);
      useStore.getState().bumpContentLayout();
    },
    [block.id],
  );
  const isHover = useStore((s) => s.hoverId) === cid;
  const streaming = !!block.streaming;
  const frame = useAnimFrame(streaming, 130);
  const term = useTerminalSize();

  // 流式结束 → 自动收成一行标识（除非用户手点过保持展开）
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      if (!userTouched.current) setOpen(false);
      useStore.getState().bumpContentLayout();
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  // 流式中：强制展开看过程（不记为 userTouched）
  useEffect(() => {
    if (streaming && !userTouched.current) setOpen(true);
  }, [streaming]);

  if (!block.content && !streaming) return null;

  const dur = durationStr(block.duration);
  const charCount = block.content.length;
  const spin = spinnerChar(frame);
  const [r, g, b] = neonRgb(frame * 0.55);
  const pulse = `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  // 悬停高亮只作用在标识行，且收纳态更明显
  const markColor = isHover ? t.accent : streaming ? pulse : t.muted;

  // 正文列宽：终端宽 − 外边距 − logo − 二级 * 缩进 − 少许余量
  const bodyCols = Math.max(16, (term.cols || 80) - 12);

  // 流式：始终露正文（固定高度窗口）；结束后：仅用户展开时显示
  const showBody = (streaming || open) && (!!block.content || streaming);
  const clipped = useMemo(
    () =>
      showBody
        ? stableThinkLines(block.content, THINK_MAX_LINES, bodyCols, streaming)
        : null,
    [showBody, block.content, streaming, bodyCols],
  );

  return (
    <Box flexDirection="column">
      {/* 二级标记：正文列内再留 2 列给 *；仅此行可点展开/收起 */}
      <Box ref={ref} flexDirection="row">
        <Box width={2} flexShrink={0}>
          <Text color={markColor}>{streaming ? `${spin} ` : "* "}</Text>
        </Box>
        <Text color={markColor}>
          {streaming
            ? `think ${spin}${dotsAnim(frame)} // ${charCount} 字`
            : `think${dur ? ` (${dur})` : ""} // ${charCount} 字 ${open ? "▼" : "▶"}`}
        </Text>
      </Box>
      {showBody && clipped ? (
        <Box flexDirection="column">
          {/* 每行独立 Text、禁止 wrap —— 高度 = lines.length（流式恒为 THINK_MAX_LINES） */}
          {clipped.lines.map((ln, i) => (
            <Box key={i} flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text>{"  "}</Text>
              </Box>
              <Text color={streaming ? t.fg : t.muted}>
                {ln || (streaming ? " " : "")}
              </Text>
            </Box>
          ))}
          {clipped.clipped && !streaming ? (
            <Box flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text>{"  "}</Text>
              </Box>
              <Text color={t.dim}>{`… 共 ${clipped.total} 行 · 仅显示 ${THINK_MAX_LINES} 行`}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
