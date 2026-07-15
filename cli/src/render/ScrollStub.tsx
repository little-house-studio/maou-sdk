/**
 * 滚动中的轻量占位行（Grok 式：scrub 时不挂 MD/ToolCard）。
 * 固定 height = 缓存行高，避免与完整 MessageRow 切换时总高乱跳。
 */

import React, { memo } from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import type { ChatMessage, SystemEvent } from "../state/types.js";
import { repairUtf8Mojibake } from "../input/filtered-stdin.js";

function clip(s: string, maxW: number): string {
  const t = repairUtf8Mojibake(s || "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "…";
  if (stringWidth(t) <= maxW) return t;
  let out = "";
  let w = 0;
  for (const ch of t) {
    const cw = stringWidth(ch) || 1;
    if (w + cw > maxW - 1) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

function StubLines({
  lines,
  width,
  color,
  bg,
  height,
}: {
  lines: string[];
  width: number;
  color: string;
  bg?: string;
  height: number;
}) {
  const h = Math.max(1, height);
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < h; i++) {
    const text = clip(lines[i] ?? " ", Math.max(1, width - 1));
    rows.push(
      <Text key={i} color={color} backgroundColor={bg}>
        {text}
      </Text>,
    );
  }
  return (
    <Box flexDirection="column" width={width} height={h} overflow="hidden">
      {rows}
    </Box>
  );
}

export const ScrollStubMsg = memo(function ScrollStubMsg({
  msg,
  height,
  width,
  userColor,
  userBg,
  assistantColor,
  dim,
}: {
  msg: ChatMessage;
  height: number;
  width: number;
  userColor: string;
  userBg: string;
  assistantColor: string;
  dim: string;
}) {
  const w = Math.max(8, width);
  const h = Math.max(1, Math.round(height));
  if (msg.role === "user") {
    const body = clip(msg.content || "", w - 2);
    return (
      <StubLines
        height={h}
        width={w}
        color={userColor}
        bg={userBg}
        lines={[` ${body}`, ...Array(Math.max(0, h - 1)).fill(" ")]}
      />
    );
  }
  const tools = (msg.toolCalls ?? []).length;
  const head = clip(
    `◈ ${msg.role === "assistant" ? "agent" : msg.role} · ${(msg.content || "").replace(/\n/g, " ")}`,
    w,
  );
  const toolLine =
    tools > 0 ? clip(`  ▸ ${tools} tool${tools > 1 ? "s" : ""}`, w) : "";
  const lines = [head];
  if (toolLine) lines.push(toolLine);
  while (lines.length < h) lines.push("");
  return (
    <StubLines
      height={h}
      width={w}
      color={assistantColor}
      lines={lines.slice(0, h).map((l, i) => (i > 0 && !l ? " " : l))}
    />
  );
});

export const ScrollStubSys = memo(function ScrollStubSys({
  ev,
  height,
  width,
  color,
}: {
  ev: SystemEvent;
  height: number;
  width: number;
  color: string;
}) {
  const w = Math.max(8, width);
  const h = Math.max(1, Math.round(height));
  const line = clip(`[${ev.kind}] ${ev.content || ""}`, w);
  return (
    <StubLines height={h} width={w} color={color} lines={[line]} />
  );
});

/**
 * 是否启用滚动 stub（滑动时用纯文本占位，停稳再挂完整 MessageRow）。
 * 默认 **关**——会变成「滑的时候内容全变样」，可读性差。
 * 仅压测/极致帧率时：MAOU_SCROLL_STUB=1
 */
export function scrollStubEnabled(): boolean {
  const v = process.env.MAOU_SCROLL_STUB;
  return v === "1" || v === "true" || v === "on";
}
