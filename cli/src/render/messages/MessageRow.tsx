/**
 * MessageRow —— 按新顺序格式渲染单条消息。
 *
 * user 消息：
 *   ▸ 消息id | user | 时间点 | ↑上传总token  （灰橙色）
 *   发送内容（橙色）
 *
 * assistant 消息：
 *   ◈ loop次数 | ai | 时间点 | (生成耗时) | ↓生成token  （灰色）
 *   * think (生成耗时)  （灰色，收纳，可展开）
 *   content 生成内容（白色）
 *   [缩进] 工具调用卡片
 *
 * system 消息走 SystemEventRow。
 *
 * 流式 spinner 静态（◐），避免每 200ms 重渲触发 MarkdownRenderer 重新解析（卡顿）。
 */

import React from "react";
import { Box } from "ink";
import { useTheme } from "../../theme/theme-context.js";
import type { ChatMessage } from "../../state/types.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";
import { ToolCard } from "./ToolCard.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { SelectableText } from "../SelectableText.js";
import { timecode, shortId, durationStr, loopMark, compact } from "../../layout/decorators.js";

export function MessageRow({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = useTheme();
  const ts = timecode(new Date(msg.ts));

  if (msg.role === "user") {
    const upTok = msg.usage ? compact(msg.usage.input) : "";
    return (
      <Box flexDirection="column">
        <SelectableText color={t.dim}>{`▸ ${shortId(msg.id)} | user | ${ts}${upTok ? ` | ↑${upTok}` : ""}`}</SelectableText>
        <Box backgroundColor={t.userBg}>
          <SelectableText color={t.user} wrap="wrap">{msg.content}</SelectableText>
        </Box>
      </Box>
    );
  }
  if (msg.role === "assistant") {
    const dnTok = msg.usage ? compact(msg.usage.output) : "";
    const dur = durationStr(msg.duration);
    const round = msg.round ?? 0;
    return (
      <Box flexDirection="column">
        <SelectableText color={t.dim}>
          {`◈ ${loopMark(round, 0)} | ai | ${ts}${dur ? ` | (${dur})` : ""}${dnTok ? ` | ↓${dnTok}` : ""}`}
        </SelectableText>
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
      </Box>
    );
  }
  // system 角色消息（非 SystemEvent）用 systemBg 块
  return <SelectableText backgroundColor={t.systemBg} color={t.system}>{`▣ ${msg.content}`}</SelectableText>;
}
