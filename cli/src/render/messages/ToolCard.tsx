/**
 * ToolCard —— 工具调用卡片（新格式）。
 *
 * 标题行：工具名(黄背景) | 描述(浅灰背景) | 成功符号 ✓✗○ | (返回耗时)
 *   默认收纳，点击整个卡片区域展开/收纳（拖拽时不收纳而选字）。
 * 展开后：
 *   - 工具调用参数（黄色字）
 *   - 完整返回结果（灰色字）
 *   - 编辑类工具：diff 绿色添加/红色删除
 *   - 多次返回的工具：按 toolCallId 累加显示
 */

import React, { useState, useMemo, useRef } from "react";
import { Box } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ToolCardState } from "../../state/types.js";
import { DiffRenderer } from "./DiffRenderer.js";
import { useClickTarget } from "../../input/click-target.js";
import { truncate, durationStr } from "../../layout/decorators.js";
import { SelectableText } from "../SelectableText.js";
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
  // 读工具默认收纳；写工具默认展开（thinkingLevel 高时也展开）
  const defaultOpen = isWrite || thinkingLevel >= 4;
  const [open, setOpen] = useState(defaultOpen);

  // 成功符号：绿✓ / 红✗ / 灰○(等待)
  const statusChar = tool.done ? (tool.isError ? "✗" : "✓") : "○";
  const statusColor = tool.isError ? t.err : tool.done ? t.ok : t.dim;
  const term = useTerminalSize();
  const desc = useMemo(() => truncate(extractDescription(tool.args), Math.max(10, term.cols - 40)), [tool.args, term.cols]);
  const nearby = useMemo(() => extractNearbyLines(tool.result, 10), [tool.result]);
  const callDur = durationStr(tool.callDuration);

  // 鼠标点击标题行切换折叠（仅工具有结果时可折叠）
  const headerRef = useRef<DOMElement | null>(null);
  const toggle = () => { if (tool.result !== undefined) setOpen(o => !o); };
  useClickTarget(headerRef, toggle, [tool.result, tool.id]);

  const isDiff = useMemo(() => isWrite && !!tool.result && /^@@ |^--- |^\+\+\+ /m.test(tool.result), [tool.result, isWrite]);

  // 标题行：工具名(黄背景) 描述(浅灰背景) 符号 (耗时) ▶/▼
  // SelectableText 单颜色，黄背景用 Box 包裹背景。这里简化：整行一个 SelectableText，颜色用 statusColor
  const headerText = `${tool.name} ${desc} ${statusChar}${callDur ? ` (${callDur})` : ""}${tool.result !== undefined ? ` ${open ? "▼" : "▶"}` : ""}`;

  return (
    <Box paddingLeft={1} flexDirection="column">
      <Box ref={headerRef}>
        {/* 工具名黄背景 */}
        <SelectableText backgroundColor={t.warn} color="#000" bold>{` ${tool.name} `}</SelectableText>
        {/* 描述 + 符号 + 耗时 */}
        <SelectableText color={statusColor}>{` ${desc} ${statusChar}${callDur ? ` (${callDur})` : ""}${tool.result !== undefined ? ` ${open ? "▼" : "▶"}` : ""}`}</SelectableText>
      </Box>
      {open && tool.result !== undefined && (
        isDiff ? (
          <DiffRenderer diff={tool.result} />
        ) : (
          <Box paddingLeft={3} flexDirection="column">
            {/* 参数（黄色字） */}
            {tool.args && tool.args !== "{}" && (
              <SelectableText color={t.warn}>{`▸ args: ${truncate(tool.args, term.cols - 8)}`}</SelectableText>
            )}
            {/* 返回结果（灰色字）/ 附近行 */}
            {isWrite && nearby ? (
              nearby.split("\n").map((l, i) => (
                <SelectableText key={i} color={tool.isError ? t.err : t.toolResult}>{l || " "}</SelectableText>
              ))
            ) : (
              <SelectableText color={tool.isError ? t.err : t.toolResult}>{String(tool.result).slice(0, 1500)}</SelectableText>
            )}
          </Box>
        )
      )}
    </Box>
  );
}
