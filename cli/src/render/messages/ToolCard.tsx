/**
 * ToolCard —— 磁带计数器风格工具卡片（折叠/展开）。
 * 装饰：▌NN name ▸ preview ▶/▼，磁带计数器边框。
 * 读工具（read/glob/grep/ls）默认收纳；写工具（create/edit/write）默认展开显示附近 10 行。
 * 6 级思考级别控制展开程度（thinkingLevel ≥ 3 自动展开写工具）。
 */

import React, { useState, useMemo, useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import { useStore } from "../../state/store.js";
import type { ToolCardState } from "../../state/types.js";
import { SYMBOLS } from "../../theme/tokens.js";
import { DiffRenderer } from "./DiffRenderer.js";
import { useClickTarget } from "../../input/click-target.js";
import { truncate } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

const READ_TOOLS = new Set(["read", "glob", "grep", "ls", "list", "search", "find", "cat"]);
const WRITE_TOOLS = new Set(["create", "edit", "write", "patch", "rm", "remove", "mkdir", "move"]);

function extractPreview(args: string): string {
  try {
    const a = JSON.parse(args);
    return a.path || a.file_path || a.command?.slice(0, 40) || a.pattern || a.query?.slice(0, 30) || args.slice(0, 30);
  } catch {
    return args.slice(0, 30);
  }
}

function extractNearbyLines(result: string | undefined, lines = 10): string {
  if (!result) return "";
  const all = result.split("\n");
  return all.slice(0, lines).join("\n");
}

export function ToolCard({ tool, index, frame }: { tool: ToolCardState; index: number; frame: number }) {
  const t = useTheme();
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const isRead = READ_TOOLS.has(tool.name.toLowerCase());
  const isWrite = WRITE_TOOLS.has(tool.name.toLowerCase());
  // 读工具默认收纳；写工具默认展开（thinkingLevel 高时也展开）
  const defaultOpen = isWrite || thinkingLevel >= 4;
  const [open, setOpen] = useState(defaultOpen);
  const [userToggle] = useState(false);

  const color = tool.isError ? t.err : tool.done ? t.ok : t.warn;
  // spinner 静态：避免每个运行中 ToolCard 各开 200ms interval（多工具时 interval 爆炸致卡）。
  // 流式进度由 EventBlock 状态显示，卡片用静态符号区分运行中/完成。
  const status = tool.done ? (tool.isError ? "✗" : "✓") : "○";
  const term = useTerminalSize();
  const preview = useMemo(() => truncate(extractPreview(tool.args), Math.max(10, term.cols - 30)), [tool.args, term.cols]);
  const nearby = useMemo(() => extractNearbyLines(tool.result, 10), [tool.result]);

  // 鼠标点击标题行切换折叠（仅工具有结果时可折叠）
  const headerRef = useRef<DOMElement | null>(null);
  const toggle = () => { if (tool.result !== undefined) setOpen(o => !o); };
  useClickTarget(headerRef, toggle, [tool.result, tool.id]);

  const isDiff = useMemo(() => isWrite && !!tool.result && /^@@ |^--- |^\+\+\+ /m.test(tool.result), [tool.result, isWrite]);

  return (
    <Box paddingLeft={1} flexDirection="column">
      <Box ref={headerRef}>
        <Text color={t.dim}>{SYMBOLS.index}{String(index).padStart(2, "0")}</Text>
        <Text color={color}> {status} </Text>
        <Text color={t.tool} bold>{tool.name}</Text>
        <Text color={t.muted}> {preview}</Text>
        {tool.result !== undefined && (
          <Text color={t.accent}> {(userToggle ? open : open) ? "▼" : "▶"}</Text>
        )}
      </Box>
      {open && tool.result !== undefined && (
        isDiff ? (
          <DiffRenderer diff={tool.result} />
        ) : (
          <Box paddingLeft={3} flexDirection="column">
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
