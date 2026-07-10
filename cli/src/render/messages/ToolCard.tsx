/**
 * ToolCard —— 工具调用卡片。
 * 默认收纳（含历史加载）；点击标题行展开/收纳。
 */

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Box, Text, useBoxMetrics } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ToolCardState } from "../../state/types.js";
import { DiffRenderer } from "./DiffRenderer.js";
import { useClickTarget } from "../../input/click-target.js";
import { truncate, durationStr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";
import { CollapsibleText } from "./Collapsible.js";

const WRITE_TOOLS = new Set(["create", "edit", "write", "patch", "rm", "remove", "mkdir", "move", "write_file", "edit_file"]);

function extractDescription(args: string): string {
  try {
    const a = JSON.parse(args);
    return a.path || a.file_path || a.command?.slice(0, 40) || a.pattern || a.query?.slice(0, 30) || args.slice(0, 30);
  } catch {
    return args.slice(0, 30);
  }
}

export function ToolCard({ tool, index: _index, frame: _frame }: { tool: ToolCardState; index: number; frame: number }) {
  const t = useTheme();
  const isWrite = WRITE_TOOLS.has(tool.name.toLowerCase());
  // 一律默认收纳（历史加载 + 运行时完成态）；仅执行中（!done）可微开状态提示
  const [open, setOpen] = useState(false);

  const statusChar = tool.done ? (tool.isError ? "✗" : "✓") : "○";
  const statusColor = tool.isError ? t.err : tool.done ? t.ok : t.dim;
  const term = useTerminalSize();
  const desc = useMemo(
    () => truncate(extractDescription(tool.args), Math.max(10, term.cols - 40)),
    [tool.args, term.cols],
  );
  const callDur = durationStr(tool.callDuration);

  const rootRef = useRef<DOMElement | null>(null);
  const rootMetrics = useBoxMetrics(rootRef);
  const prevHeightRef = useRef<number>(0);
  const toggle = () => {
    if (tool.result !== undefined || tool.done) setOpen((o) => !o);
  };
  const cid = useClickTarget(rootRef, toggle, [tool.result, tool.id, open, tool.done]);
  const isHover = useStore((s) => s.hoverId) === cid;

  useEffect(() => {
    const h = rootMetrics.height ?? 0;
    const delta = h - prevHeightRef.current;
    if (prevHeightRef.current > 0 && delta !== 0) {
      useStore.getState().expandShift(delta);
    }
    prevHeightRef.current = h;
  }, [rootMetrics.height]);

  const isDiff = useMemo(
    () => isWrite && !!tool.result && /^@@ |^--- |^\+\+\+ /m.test(tool.result),
    [tool.result, isWrite],
  );

  return (
    <Box ref={rootRef} flexDirection="column">
      <Box>
        <Text backgroundColor={isHover ? t.accent2 : t.warn} color="#000" bold>{` ${tool.name} `}</Text>
        <Text backgroundColor={isHover ? t.muted : t.panelBg} color={t.fg}>{` ${desc} `}</Text>
        <Text color={statusColor}>
          {` ${statusChar}${callDur ? ` (${callDur})` : ""}${tool.done || tool.result !== undefined ? ` ${open ? "▼" : "▶"}` : ""}`}
        </Text>
      </Box>
      {open && tool.result !== undefined && (
        isDiff ? (
          <DiffRenderer diff={tool.result} />
        ) : (
          <Box flexDirection="column">
            {tool.args && tool.args !== "{}" && (
              <Text color={t.warn}>{`args: ${truncate(tool.args, Math.max(12, term.cols - 12))}`}</Text>
            )}
            <CollapsibleText
              text={String(tool.result)}
              color={tool.isError ? t.err : t.toolResult}
              maxLines={10}
            />
          </Box>
        )
      )}
    </Box>
  );
}
