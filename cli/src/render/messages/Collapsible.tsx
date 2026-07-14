/**
 * Collapsible —— 超过 maxLines 自动折叠，点击展开/收纳。
 * 用于用户气泡正文、assistant 正文、工具结果。流式中不折叠。
 */

import React, { useState, useRef, useMemo } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import { useClickTarget } from "../../input/click-target.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import stringWidth from "string-width";

const DEFAULT_MAX = 10;

/** 估算换行后的显示行数（按终端宽粗算） */
export function estimateLines(text: string, colWidth: number): number {
  if (!text) return 0;
  const w = Math.max(8, colWidth);
  let lines = 0;
  for (const raw of text.split("\n")) {
    const lw = stringWidth(raw) || 1;
    lines += Math.max(1, Math.ceil(lw / w));
  }
  return lines;
}

/** 按显示宽度截成前 maxLines 行的纯文本预览 */
function previewText(text: string, colWidth: number, maxLines: number): string {
  const w = Math.max(8, colWidth);
  const out: string[] = [];
  let used = 0;
  for (const raw of text.split("\n")) {
    if (used >= maxLines) break;
    const lw = stringWidth(raw) || 0;
    const need = Math.max(1, Math.ceil(Math.max(1, lw) / w));
    if (used + need <= maxLines) {
      out.push(raw);
      used += need;
    } else {
      let acc = "";
      let accW = 0;
      const budget = (maxLines - used) * w;
      for (const ch of raw) {
        const cw = stringWidth(ch) || 1;
        if (accW + cw > budget) break;
        acc += ch;
        accW += cw;
      }
      out.push(acc + "…");
      used = maxLines;
      break;
    }
  }
  return out.join("\n");
}

export function CollapsibleText({
  text,
  color,
  maxLines = DEFAULT_MAX,
  streaming = false,
  bg,
  label,
  defaultOpen = false,
}: {
  text: string;
  color?: string;
  maxLines?: number;
  streaming?: boolean;
  /** 若提供，每行铺满 bg（用户气泡用） */
  bg?: string;
  /** 用户气泡：每行 pad 到该宽度 */
  fillWidth?: number;
  /** 可选区标题（如「输入」「输出」） */
  label?: string;
  /** 默认是否展开（默认 false=过长先折） */
  defaultOpen?: boolean;
}) {
  const t = useTheme();
  const term = useTerminalSize();
  // 与对话正文列对齐，避免长行撑破右边框
  const colW = Math.max(12, term.cols - 2 - 2 - 4);
  const total = useMemo(() => estimateLines(text, colW), [text, colW]);
  const need = !streaming && total > maxLines;
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(
    ref,
    () => {
      if (need) setOpen((o) => !o);
    },
    [need, open],
  );
  const isHover = useStore((s) => s.hoverId) === cid;

  if (!text) return null;

  const show = need && !open ? previewText(text, colW, maxLines) : text;
  const lines = show.split("\n");

  return (
    <Box ref={ref} flexDirection="column">
      {label ? (
        <Text color={t.dim} backgroundColor={bg}>
          {label}
        </Text>
      ) : null}
      {lines.map((l, i) => (
        <Text key={i} color={color ?? t.fg} backgroundColor={bg}>
          {l || " "}
        </Text>
      ))}
      {need && (
        <Text color={isHover ? t.accent : t.dim} backgroundColor={bg}>
          {open
            ? ` ▲ 收起（共 ${total} 行 · 点击收起）`
            : ` ▼ 展开全文（已折叠 ${total} 行 · 点击展开）`}
        </Text>
      )}
    </Box>
  );
}
