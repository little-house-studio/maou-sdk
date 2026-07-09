/**
 * ToolCard —— 工具调用卡片（设计文档格式）。
 *
 * 标题行：工具名(黄色背景) | 描述(浅灰色背景) | 成功符号 ✓✗○ | (返回耗时)
 *   默认收纳，点击整个卡片区域都能展开/收纳（拖拽时不收纳而选字）。
 * 展开后：
 *   - 工具调用参数（黄色字）
 *   - 完整返回结果（灰色字）
 *   - 编辑类工具：diff 绿色添加/红色删除
 *   - 多次返回的工具：按 toolCallId 累加显示
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

const READ_TOOLS = new Set(["read", "glob", "grep", "ls", "list", "search", "find", "cat"]);
const WRITE_TOOLS = new Set(["create", "edit", "write", "patch", "rm", "remove", "mkdir", "move"]);

function extractDescription(args: string): string {
  try {
    const a = JSON.parse(args);
    return a.path || a.file_path || a.command?.slice(0, 40) || a.pattern || a.query?.slice(0, 30) || args.slice(0, 30);
  } catch {
    return args.slice(0, 30);
  }
}

function extractNearbyLines(result: string | undefined, lines = 10): string {
  if (!result) return "";
  return result.split("\n").slice(0, lines).join("\n");
}

export function ToolCard({ tool, index, frame }: { tool: ToolCardState; index: number; frame: number }) {
  const t = useTheme();
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const isRead = READ_TOOLS.has(tool.name.toLowerCase());
  const isWrite = WRITE_TOOLS.has(tool.name.toLowerCase());
  const defaultOpen = isWrite || thinkingLevel >= 4;
  const [open, setOpen] = useState(defaultOpen);

  // 成功符号：绿✓ / 红✗ / 灰○(等待)
  const statusChar = tool.done ? (tool.isError ? "✗" : "✓") : "○";
  const statusColor = tool.isError ? t.err : tool.done ? t.ok : t.dim;
  const term = useTerminalSize();
  const desc = useMemo(() => truncate(extractDescription(tool.args), Math.max(10, term.cols - 40)), [tool.args, term.cols]);
  const nearby = useMemo(() => extractNearbyLines(tool.result, 10), [tool.result]);
  const callDur = durationStr(tool.callDuration);

  // 鼠标点击整个卡片区域切换折叠
  const rootRef = useRef<DOMElement | null>(null);
  const rootMetrics = useBoxMetrics(rootRef);
  const prevHeightRef = useRef<number>(0);
  const toggle = () => { if (tool.result !== undefined) setOpen(o => !o); };
  const cid = useClickTarget(rootRef, toggle, [tool.result, tool.id, open]);
  const isHover = useStore((s) => s.hoverId) === cid;

  // 展开/折叠锚定
  useEffect(() => {
    const h = rootMetrics.height ?? 0;
    const delta = h - prevHeightRef.current;
    if (prevHeightRef.current > 0 && delta !== 0) {
      useStore.getState().expandShift(delta);
    }
    prevHeightRef.current = h;
  }, [rootMetrics.height]);

  const isDiff = useMemo(() => isWrite && !!tool.result && /^@@ |^--- |^\+\+\+ /m.test(tool.result), [tool.result, isWrite]);

  return (
    <Box ref={rootRef} flexDirection="column">
      {/* 标题行：工具名(黄背景) 描述(浅灰背景) 符号(绿/红/灰) (耗时) ▶/▼ */}
      <Box>
        <Text backgroundColor={isHover ? t.accent2 : t.warn} color="#000" bold>{` ${tool.name} `}</Text>
        <Text backgroundColor={isHover ? t.muted : t.panelBg} color={t.fg}>{` ${desc} `}</Text>
        <Text color={statusColor}>{` ${statusChar}${callDur ? ` (${callDur})` : ""}${tool.result !== undefined ? ` ${open ? "▼" : "▶"}` : ""}`}</Text>
      </Box>
      {/* 展开后：参数(黄色) + 结果(灰色) + diff(绿红) */}
      {open && tool.result !== undefined && (
        isDiff ? (
          <DiffRenderer diff={tool.result} />
        ) : (
          <Box paddingLeft={2} flexDirection="column">
            {tool.args && tool.args !== "{}" && (
              <Text color={t.warn}>{`▸ args: ${truncate(tool.args, term.cols - 8)}`}</Text>
            )}
            {isWrite && nearby ? (
              nearby.split("\n").map((l, i) => (
                <Text key={i} color={tool.isError ? t.err : t.toolResult}>{l || " "}</Text>
              ))
            ) : (
              <Text color={tool.isError ? t.err : t.toolResult}>{String(tool.result).slice(0, 1500)}</Text>
            )}
          </Box>
        )
      )}
    </Box>
  );
}
