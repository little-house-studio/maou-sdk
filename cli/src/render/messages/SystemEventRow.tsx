/**
 * SystemEventRow —— 系统事件（>>>>[sym …]<<<< 全宽）。
 * 展开详情缩进到与 MsgBody 正文列对齐（logo 列空出）。
 */

import React, { useState, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { SystemEvent } from "../../state/types.js";
import { useStore } from "../../state/store.js";
import { timecode, systemEventSymbol } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { useClickTarget } from "../../input/click-target.js";
import { MsgBody } from "./MsgLayout.js";

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
  const cid = useClickTarget(ref, () => setOpen((o) => !o), [ev.id, open]);
  const isHover = useStore((s) => s.hoverId) === cid;

  const sym = systemEventSymbol(ev.kind);
  const color = isHover ? t.accent : (KIND_COLOR[ev.kind] ?? t.dim);
  const ts = timecode(new Date(ev.ts));
  const inner = `[${sym} ${ev.content} | ${ts}]`;
  const padTotal = Math.max(0, term.cols - inner.length - 2);
  const padLeft = Math.floor(padTotal / 2);
  const padRight = padTotal - padLeft;
  const line = `${">".repeat(padLeft)}${inner}${"<".repeat(padRight)}`;

  return (
    <Box ref={ref} flexDirection="column">
      <Text color={color}>{line}</Text>
      {open && ev.detail && (
        <MsgBody>
          <Text color={t.dim} wrap="wrap">{ev.detail}</Text>
        </MsgBody>
      )}
    </Box>
  );
}
