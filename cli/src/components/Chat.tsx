/** 聊天组件 —— Message / ToolCard / ThinkingBlock / ChatView */
import React from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "../state/store.js";
import { currentTheme } from "../theme.js";
import { Spinner } from "./graphics.js";

function roleGlyph(role: string): { icon: string; label: string } {
  switch (role) {
    case "user": return { icon: "▶", label: "你" };
    case "assistant": return { icon: "✦", label: "Vampire" };
    case "system": return { icon: "⚙", label: "系统" };
    case "tool": return { icon: "🔧", label: "工具" };
    default: return { icon: "•", label: role };
  }
}

function ToolCard({ tool, frame }: { tool: NonNullable<ChatMessage["toolCalls"]>[number]; frame: number }) {
  const t = currentTheme;
  const statusColor = tool.isError ? t.status.err : tool.done ? t.status.ok : t.status.warn;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={statusColor} paddingX={1} marginY={0}>
      <Box>
        {!tool.done ? <Spinner frame={frame} color={statusColor} /> : <Text color={statusColor}>{tool.isError ? "✗" : "✓"}</Text>}
        <Text color={t.role.tool} bold> {tool.name}</Text>
        <Text color={t.dim}>({tool.args.slice(0, 40)})</Text>
      </Box>
      {tool.result !== undefined && (
        <Text color={tool.isError ? t.status.err : t.role.toolResult}>  → {String(tool.result).slice(0, 120)}</Text>
      )}
    </Box>
  );
}

export function Message({ msg, frame }: { msg: ChatMessage; frame: number }) {
  const t = currentTheme;
  const { icon, label } = roleGlyph(msg.role);
  const color = t.role[(msg.role === "assistant" ? "assistant" : msg.role === "user" ? "user" : msg.role === "tool" ? "tool" : "system") as keyof typeof t.role];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color} bold>{icon} {label}</Text>
        {msg.streaming && <Text color={t.dim}> <Spinner frame={frame} kind="pulse" /></Text>}
        {msg.usage && <Text color={t.dim}>  · {msg.usage.input}+{msg.usage.output}tok</Text>}
      </Box>
      {msg.thinking && (
        <Box paddingLeft={2} marginBottom={0}>
          <Text color={t.dim} italic>💭 {msg.thinking.slice(-200)}</Text>
        </Box>
      )}
      {msg.content && (
        <Box paddingLeft={2}>
          <Text color={msg.role === "user" ? t.fg : color} wrap="wrap">{msg.content}</Text>
        </Box>
      )}
      {msg.toolCalls?.map((tc) => (
        <Box key={tc.id} paddingLeft={2}><ToolCard tool={tc} frame={frame} /></Box>
      ))}
    </Box>
  );
}

export function ChatView({ messages, frame, maxRows }: { messages: ChatMessage[]; frame: number; maxRows: number }) {
  const t = currentTheme;
  // 只渲染最近的消息（按估算行数裁剪，避免溢出）
  const visible = messages.slice(-12);
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
        <Text color={t.dim}>╭───────────────────────────────╮</Text>
        <Text color={t.dim}>│  与 Vampire 对话，输入消息开始  │</Text>
        <Text color={t.dim}>│  Ctrl+K 命令 · Ctrl+M 选模型   │</Text>
        <Text color={t.dim}>╰───────────────────────────────╯</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" flexGrow={1}>
      {visible.map((m) => <Message key={m.id} msg={m} frame={frame} />)}
    </Box>
  );
}
