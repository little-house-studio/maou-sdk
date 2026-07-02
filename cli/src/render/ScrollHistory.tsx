/**
 * ScrollHistory —— 视口模式渲染，规避 Ink #935（eraseLines 行数错导致顶部 border 丢失）。
 *
 * 不用 <Static>（它会写 scrollback 触发 Ink clearTerminal 抹顶部）。
 * 改全动态渲染 + 自管视口：算每条消息估算行数，从末尾累加到可用高度停止。
 * outputHeight 永远 ≤ 视口高度，Ink eraseLines 不算错，┌ border 保留。
 * chatScrollOffset 控制向上滚动看更早消息。
 */

import React, { useEffect, useState, useMemo } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { MessageRow } from "./messages/MessageRow.js";
import type { ChatMessage } from "../state/types.js";

/** 估算单条消息渲染行数（含时码行/usage/内容/工具卡片/分隔线） */
function estimateRows(msg: ChatMessage, cols: number): number {
  const contentCols = Math.max(20, cols - 4); // 减边框+padding
  let rows = 2; // 时码行 + 角色
  if (msg.usage) rows += 1;
  if (msg.content) rows += Math.ceil(msg.content.length / contentCols) + (msg.content.includes("\n") ? msg.content.split("\n").length - 1 : 0);
  if (msg.thinkingBlocks) rows += msg.thinkingBlocks.reduce((a, b) => a + Math.max(1, Math.ceil(b.content.length / contentCols)), 0);
  if (msg.toolCalls) rows += msg.toolCalls.length * 2; // 标题行 + 可能展开
  rows += 1; // 分隔线
  return Math.max(2, rows);
}

export function ScrollHistory({ frame }: { frame: number }) {
  const t = useTheme();
  const messages = useStore((s) => s.messages);
  const chatScrollOffset = useStore((s) => s.chatScrollOffset);
  const term = useTerminalSize();
  const [, force] = useState(0);

  // 自适应节流（保留，规避高频重渲染）
  useEffect(() => {
    if (messages.length === 0) return;
    const id = setTimeout(() => force(f => f + 1), 50);
    return () => clearTimeout(id);
  }, [messages]);

  // 可用高度：终端高 - 顶栏(1) - 对话区上下边框(2) - 事件块(1) - 输入框(1) - 状态栏(1) = rows - 6
  const availableRows = Math.max(4, term.rows - 6);

  if (messages.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
        <Text color={t.accent} bold>▌ MAOU // 待命</Text>
        <Text color={t.dim}>输入消息开始对话</Text>
        <Text color={t.dim}>Ctrl+K 命令 · Ctrl+E 全屏 · Ctrl+G 编辑器 · Ctrl+C 退出</Text>
      </Box>
    );
  }

  // 从末尾倒取消息，累加行数到 availableRows 停止（+ offset 向上看更早）
  const visible: ChatMessage[] = [];
  let usedRows = 0;
  const startIdx = Math.max(0, messages.length - 1 - chatScrollOffset);
  for (let i = startIdx; i >= 0; i--) {
    const m = messages[i]!;
    const r = estimateRows(m, term.cols);
    // 第一条总放（即使超视口），后续放不下就停
    if (usedRows + r > availableRows && visible.length > 0) break;
    visible.unshift(m);
    usedRows += r;
  }
  const hiddenCount = startIdx - (messages.length - visible.length);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {hiddenCount > 0 && <Text color={t.dim}>▲ {hiddenCount} 条更早消息（滚轮向上看）</Text>}
      {visible.map(m => <MessageRow key={m.id} msg={m} frame={frame} />)}
    </Box>
  );
}
