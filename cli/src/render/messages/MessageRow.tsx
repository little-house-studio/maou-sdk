/**
 * MessageRow —— 单条消息布局（角色色块 + 时码 + 代号）。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage } from "../../state/types.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { timecode, codename } from "../../layout/decorators.js";

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function MessageRow({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = useTheme();
  const ts = timecode(new Date(msg.ts));

  if (msg.role === "user") {
    return (
      <Box flexDirection="column">
        <Text color={t.dim}>{ts} {codename("user")}</Text>
        <Text backgroundColor={t.userBg} color={t.user} wrap="wrap">▸ {msg.content}</Text>
      </Box>
    );
  }
  if (msg.role === "assistant") {
    return (
      <Box flexDirection="column">
        <Text color={t.dim}>{ts} {codename("assistant")}</Text>
        <Box>
          <Text color={t.assistant}>{msg.streaming ? SPIN[frame % SPIN.length] : "●"}</Text>
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
        <Text color={t.mdHr}>{"─".repeat(40)}</Text>
      </Box>
    );
  }
  return <Text backgroundColor={t.systemBg} color={t.system}>▣ {msg.content}</Text>;
}
