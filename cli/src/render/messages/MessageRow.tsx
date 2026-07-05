/**
 * MessageRow —— 单条消息布局（角色色块 + 时码 + 代号）。
 *
 * 流式时 spinner 用静态字符（不动画）——避免每 200ms 重渲 MessageRow
 * 触发 MarkdownRenderer 重新 marked.lexer 解析（卡顿根因）。流式进度由
 * EventBlock 显示。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage } from "../../state/types.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { SelectableText } from "../SelectableText.js";
import { timecode, codename, hr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

export function MessageRow({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = useTheme();
  const ts = timecode(new Date(msg.ts));
  const term = useTerminalSize();

  if (msg.role === "user") {
    return (
      <Box flexDirection="column">
        <Text color={t.dim}>{ts} {codename("user")}</Text>
        <Box backgroundColor={t.userBg}>
          <SelectableText color={t.user} wrap="wrap">{`▸ ${msg.content}`}</SelectableText>
        </Box>
      </Box>
    );
  }
  if (msg.role === "assistant") {
    return (
      <Box flexDirection="column">
        <Text color={t.dim}>{ts} {codename("assistant")}</Text>
        <Box>
          <Text color={t.assistant}>{msg.streaming ? "◐" : "●"}</Text>
          {msg.usage && (
            <Text color={t.dim}> {msg.usage.input}↑{msg.usage.output}↓{msg.usage.maxContext ? `/${Math.round(msg.usage.maxContext / 1000)}k` : ""}</Text>
          )}
        </Box>
        {msg.content && (
          <Box paddingLeft={2} flexDirection="column">
            <MarkdownRenderer md={msg.content} />
          </Box>
        )}
        {msg.thinkingBlocks && msg.thinkingBlocks.length > 0 && msg.thinkingBlocks.some(b => b.content) && (
          <Box paddingLeft={2} flexDirection="column">
            {msg.thinkingBlocks.filter(b => b.content).map(b => (
              <ThinkingBlock key={b.id} block={b} />
            ))}
          </Box>
        )}
        {msg.toolCalls?.map((tc, i) => (
          <Box key={tc.id} paddingLeft={2}><ToolCard tool={tc} index={i + 1} frame={frame} /></Box>
        ))}
        <Text color={t.mdHr}>{hr(term.cols)}</Text>
      </Box>
    );
  }
  return <Text backgroundColor={t.systemBg} color={t.system}>▣ {msg.content}</Text>;
}
