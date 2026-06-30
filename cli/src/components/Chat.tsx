/** 聊天组件 —— 借鉴 Claude Code 消息流 + DESIGN.md 背景块分块
 *  - CC 风格：⏺ 标记 assistant、⎿ 标记工具结果、缩进层级
 *  - DESIGN.md：角色背景色分块、信息密集、工具卡片折叠展开
 *  - assistant content 走 Markdown 渲染
 */
import React, { useState } from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "../state/store.js";
import { currentTheme } from "../theme.js";
import { Spinner } from "./graphics.js";
import { Markdown } from "./Markdown.js";

/** 工具卡片 —— CC 风格：⏺ ToolName(args) + ⎿ result，可折叠 */
function ToolCard({ tool, frame }: { tool: NonNullable<ChatMessage["toolCalls"]>[number]; frame: number }) {
  const t = currentTheme;
  const statusColor = tool.isError ? t.status.err : tool.done ? t.status.ok : t.status.warn;
  const [open, setOpen] = useState(false);
  const hasResult = tool.result !== undefined;
  const resultLines = hasResult ? String(tool.result).split("\n").length : 0;
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box>
        <Text color={statusColor}>{!tool.done ? "⏳" : tool.isError ? "✗" : "⏺"}</Text>
        <Text color={t.role.tool} bold> {tool.name}</Text>
        <Text color={t.dim}>({tool.args.slice(0, 50)})</Text>
        {hasResult && (
          <Text color={t.accent}> {open ? "▼" : "▶"}{resultLines}行</Text>
        )}
      </Box>
      {hasResult && open && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color={t.dim}>⎿ </Text>
          <Box paddingLeft={3}>
            <Text color={tool.isError ? t.status.err : t.role.toolResult}>{String(tool.result).slice(0, 2000)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** 单条消息 —— CC 风格标记 + DESIGN.md 背景色块 */
export function Message({ msg, frame, width }: { msg: ChatMessage; frame: number; width?: number }) {
  const t = currentTheme;
  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  const isSystem = msg.role === "system";
  const roleColor = isUser ? t.role.user : isAssistant ? t.role.assistant : t.role.system;

  return (
    <Box flexDirection="column" marginBottom={0}>
      {/* 用户消息：背景色块 + ► 标记 */}
      {isUser && (
        <Text backgroundColor={t.selectionBg} wrap="wrap">
          <Text color={t.role.user} bold>► </Text>
          <Text color={t.overlayFg}>{msg.content}</Text>
        </Text>
      )}

      {/* assistant 消息：⏺ 标记 + markdown 渲染 */}
      {isAssistant && (
        <Box flexDirection="column">
          <Box>
            <Text color={t.role.assistant}>{msg.streaming ? <Spinner frame={frame} color={t.role.assistant} /> : "⏺"}</Text>
            {msg.usage && <Text color={t.dim}>  {msg.usage.input}+{msg.usage.output}tok</Text>}
          </Box>
          {msg.thinking && (
            <Box paddingLeft={2}>
              <Text color={t.dim} italic>○ {msg.thinking.slice(-200)}</Text>
            </Box>
          )}
          {msg.content && (
            <Box paddingLeft={2}>
              <Markdown source={msg.content} width={width ? width - 4 : undefined} />
            </Box>
          )}
          {msg.toolCalls?.map((tc) => (
            <Box key={tc.id} paddingLeft={2}><ToolCard tool={tc} frame={frame} /></Box>
          ))}
        </Box>
      )}

      {/* system 消息：灰色块 */}
      {isSystem && (
        <Text backgroundColor={t.overlayBg} color={t.dim}>▣ {msg.content}</Text>
      )}

      {/* 分割线（信息密集，细线） */}
      <Text color={t.borderSoft}>{"─".repeat(Math.max(20, (width ?? 60) - 2))}</Text>
    </Box>
  );
}

export function ChatView({ messages, frame, maxRows, offset = 0, width }: { messages: ChatMessage[]; frame: number; maxRows: number; offset?: number; width?: number }) {
  const t = currentTheme;
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
        <Text color={t.dim}>╭───────────────────────────╮</Text>
        <Text color={t.dim}>│  输入消息开始对话           │</Text>
        <Text color={t.dim}>│  Ctrl+K 命令 · / 指令补全  │</Text>
        <Text color={t.dim}>╰───────────────────────────╯</Text>
      </Box>
    );
  }
  const N = Math.max(4, Math.floor((maxRows > 0 ? maxRows : 12) / 2));
  const end = Math.max(1, messages.length - offset);
  const start = Math.max(0, end - N);
  const visible = messages.slice(start, end);
  return (
    <Box flexDirection="column" flexGrow={1}>
      {start > 0 && <Text color={t.dim}>▲ 上方还有 {start} 条</Text>}
      {visible.map((m) => <Message key={m.id} msg={m} frame={frame} width={width} />)}
      {offset > 0 && <Text color={t.accent}>▼ 回到最新</Text>}
    </Box>
  );
}
