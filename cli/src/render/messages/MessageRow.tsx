/**
 * MessageRow —— 单条消息布局（角色色块 + 时码 + 代号）。
 *
 * spinner 动画局部化：streaming 消息自己维护 frame state + interval（200ms），
 * 不再依赖全 App frame prop（避免每帧重渲整个 App 树——闪烁根因之一）。
 * frame prop 仅作 fallback，流式时被局部 state 覆盖。
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage } from "../../state/types.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { timecode, codename, hr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function MessageRow({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = useTheme();
  const ts = timecode(new Date(msg.ts));
  const term = useTerminalSize();
  // 流式时局部 spinner（仅本消息重渲，不波及全 App）
  const [spin, setSpin] = useState(0);
  useEffect(() => {
    if (!msg.streaming) return;
    const id = setInterval(() => setSpin(s => (s + 1) % SPIN.length), 200);
    return () => clearInterval(id);
  }, [msg.streaming]);
  const spinChar = msg.streaming ? SPIN[spin] : SPIN[frame % SPIN.length];

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
          <Text color={t.assistant}>{msg.streaming ? spinChar : "●"}</Text>
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
