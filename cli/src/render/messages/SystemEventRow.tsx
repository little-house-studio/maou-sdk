/**
 * SystemEventRow —— 系统事件行渲染（设计文档格式）。
 *
 * (终端最左)>>>>>[显示符号 系统事件内容 | 时间点 ]<<<<<<(终端最右)
 * 根据事件类型分配颜色，点击展开看详细。
 */

import React, { useState, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { SystemEvent } from "../../state/types.js";
import { timecode, systemEventSymbol } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { useClickTarget } from "../../input/click-target.js";

const KIND_COLOR: Record<SystemEvent["kind"], string> = {
  compress: "magenta",
  abort: "red",
  retry_fail: "yellow",
  hook: "cyan",
  permission: "blue",
  env_error: "red",
  other: "gray",
};

export function SystemEventRow({ ev }: { ev: SystemEvent }) {
  const t = useTheme();
  const term = useTerminalSize();
  const [open, setOpen] = useState(false);
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, () => setOpen(o => !o), [ev.id, open]);

  const sym = systemEventSymbol(ev.kind);
  const color = KIND_COLOR[ev.kind] ?? t.dim;
  const ts = timecode(new Date(ev.ts));
  const inner = `[${sym} ${ev.content} | ${ts}]`;
  // 全宽填充 >>>>...<<<<<
  const padTotal = Math.max(0, term.cols - inner.length - 2);
  const padLeft = Math.floor(padTotal / 2);
  const padRight = padTotal - padLeft;
  const line = `${">".repeat(padLeft)}${inner}${"<".repeat(padRight)}`;

  return (
    <Box ref={ref} flexDirection="column">
      <Text color={color}>{line}</Text>
      {open && ev.detail && (
        <Text color={t.dim}>{ev.detail}</Text>
      )}
    </Box>
  );
}
