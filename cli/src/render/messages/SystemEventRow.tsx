/**
 * SystemEventRow —— 系统事件行渲染。
 *
 * 格式：(终端最左)>>>>>[符号 内容 | 时间点]<<<<<(终端最右)
 * 按事件类型配色：压缩/中断/失败/权限/环境/其他。
 * 点击展开看详细（detail 字段）。
 */

import React, { useState } from "react";
import { Box } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { SystemEvent } from "../../state/types.js";
import { SelectableText } from "../SelectableText.js";
import { timecode, systemEventSymbol, hr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

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
  const sym = systemEventSymbol(ev.kind);
  const color = KIND_COLOR[ev.kind] ?? t.dim;
  const ts = timecode(new Date(ev.ts));
  // 居中全宽：>>>>>[符号 内容 | 时间点]<<<<<
  const inner = `[${sym} ${ev.content} | ${ts}]`;
  const pad = Math.max(0, Math.floor((term.cols - inner.length - 4) / 2));
  const line = `${">".repeat(Math.min(pad, 20))}${inner}${"<".repeat(Math.min(pad, 20))}`;

  return (
    <Box flexDirection="column">
      <SelectableText color={color}>{line}</SelectableText>
      {open && ev.detail && (
        <SelectableText color={t.dim}>{ev.detail}</SelectableText>
      )}
    </Box>
  );
}
