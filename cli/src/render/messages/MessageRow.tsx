/**
 * MessageRow —— 按设计文档顺序格式渲染单条消息。
 *
 * 所有区域保留一个缩进（paddingLeft=1），给符号留空间。
 *
 * user 消息：
 *   ▸ 消息id | user | 时间点 | ↑上传总token  （灰橙色）
 *   发送内容（橙色）
 *
 * assistant 消息：
 *   ◈ loop次数 | ai | 时间点 | (生成耗时) | ↓生成token  （灰色）
 *   * think (生成耗时)  （灰色，收纳，可点开展开）
 *   content 生成内容（白色，没有就不显示）
 *   [缩进] 工具调用卡片
 *
 * system 消息走 SystemEventRow。
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage } from "../../state/types.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { timecode, shortId, durationStr, loopMark, compact, hr } from "../../layout/decorators.js";
import { useTerminalSize } from "../../hooks/useTerminalSize.js";

export function MessageRow({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = useTheme();
  const term = useTerminalSize();
  const ts = timecode(new Date(msg.ts));

  if (msg.role === "user") {
    const upTok = msg.usage ? compact(msg.usage.input) : "";
    return (
      <Box flexDirection="column" paddingLeft={1}>
        {/* ▸ 消息id | user | 时间点 | ↑上传总token （灰橙色） */}
        <Text color={t.warn}>{`▸ ${shortId(msg.id)} | user | ${ts}${upTok ? ` | ↑${upTok}` : ""}`}</Text>
        {/* 发送内容（橙色） */}
        <Box backgroundColor={t.userBg}>
          <Text color={t.user} wrap="wrap">{msg.content}</Text>
        </Box>
      </Box>
    );
  }
  if (msg.role === "assistant") {
    const dnTok = msg.usage ? compact(msg.usage.output) : "";
    const dur = durationStr(msg.duration);
    const round = msg.round ?? 0;
    return (
      <Box flexDirection="column" paddingLeft={1}>
        {/* loop 块头：────────── ↺ loop块id | 调用次数 ──────────（灰色，loop开始点就有） */}
        <Text color={t.dim}>{`${"─".repeat(10)} ↺ ${round} ${"─".repeat(Math.max(2, term.cols - 20))}`}</Text>
        {/* ◈ loop次数 | ai | 时间点 | (生成耗时) | ↓生成token （灰色） */}
        <Text color={t.dim}>
          {`◈ ${loopMark(round, 0)} | ai | ${ts}${dur ? ` | (${dur})` : ""}${dnTok ? ` | ↓${dnTok}` : ""}`}
        </Text>
        {/* * think (生成耗时)（灰色，正常收纳，没有就不显示） */}
        {msg.thinkingBlocks && msg.thinkingBlocks.length > 0 && msg.thinkingBlocks.some(b => b.content) && (
          <Box paddingLeft={1} flexDirection="column">
            {msg.thinkingBlocks.filter(b => b.content).map(b => (
              <ThinkingBlock key={b.id} block={b} />
            ))}
          </Box>
        )}
        {/* content 生成内容（白色，没有就不显示，直接没有这个块） */}
        {msg.content && (
          <Box paddingLeft={1} flexDirection="column">
            <MarkdownRenderer md={msg.content} />
          </Box>
        )}
        {/* [缩进] 工具调用卡片 */}
        {msg.toolCalls?.map((tc, i) => (
          <Box key={tc.id} paddingLeft={1}><ToolCard tool={tc} index={i + 1} frame={frame} /></Box>
        ))}
      </Box>
    );
  }
  // system 角色消息
  return <Text backgroundColor={t.systemBg} color={t.system}>{`▣ ${msg.content}`}</Text>;
}
