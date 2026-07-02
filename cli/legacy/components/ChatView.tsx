/** ChatView — 消息列表（marked 解析 + cli-highlight 代码块） */
import React, { useState } from "react";
import { Box, Text } from "ink";
import { marked } from "marked";
import { highlight } from "cli-highlight";
import type { ChatMessage } from "../state/store.js";
import { currentTheme as t } from "../theme.js";

marked.setOptions({ breaks: true, gfm: true });

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

function ToolCard({ tool, frame }: { tool: NonNullable<ChatMessage["toolCalls"]>[number]; frame: number }) {
  const [open, setOpen] = useState(false);
  const c = tool.isError ? t.status.err : tool.done ? t.status.ok : t.status.warn;
  let preview = tool.args.slice(0, 40);
  try { const a = JSON.parse(tool.args); preview = a.path || a.file_path || a.command?.slice(0, 40) || a.pattern || preview; } catch {}
  return (
    <Box paddingLeft={1} flexDirection="column">
      <Box>
        <Text color={c}>{tool.done ? (tool.isError ? "✗" : "✓") : SPIN[frame % SPIN.length]}</Text>
        <Text color={t.role.tool} bold> {tool.name}</Text>
        <Text color={t.dim}> {preview}</Text>
        {tool.result !== undefined && <Text color={t.accent} bold> {open ? "▼" : "▶"}</Text>}
      </Box>
      {open && tool.result !== undefined && (
        <Box paddingLeft={2}><Text color={tool.isError ? t.status.err : t.role.toolResult}>{String(tool.result).slice(0, 1500)}</Text></Box>
      )}
    </Box>
  );
}

/** marked tokens → Ink Text 元素 */
function renderMd(md: string): React.ReactNode[] {
  const tokens = marked.lexer(md);
  const out: React.ReactNode[] = [];
  let key = 0;
  for (const tk of tokens) {
    if (tk.type === "code") {
      const code = (tk as { text: string; lang?: string }).text;
      const lang = (tk as { lang?: string }).lang;
      try {
        const hl = highlight(code, { language: lang || undefined });
        out.push(<Box key={key++} flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
          {lang && <Text color={t.dim}>‹{lang}›</Text>}
          {hl.split("\n").map((l, i) => <Text key={i}>{l || " "}</Text>)}
        </Box>);
      } catch {
        out.push(<Box key={key++} flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
          {code.split("\n").map((l, i) => <Text key={i} color={t.role.toolResult}>{l || " "}</Text>)}
        </Box>);
      }
    } else if (tk.type === "heading") {
      const depth = (tk as { depth: number }).depth;
      const text = (tk as { text: string }).text;
      out.push(<Text key={key++} color={depth <= 2 ? t.accent : t.fg} bold>{text}</Text>);
    } else if (tk.type === "list") {
      const items = (tk as { items: { text: string }[] }).items;
      items.forEach((it, i) => out.push(<Text key={key++} color={t.fg}>  • {it.text}</Text>));
    } else if (tk.type === "blockquote") {
      const text = (tk as { text: string }).text;
      out.push(<Text key={key++} color={t.dim}>│ {text}</Text>);
    } else if (tk.type === "hr") {
      out.push(<Text key={key++} color={t.border}>{"─".repeat(40)}</Text>);
    } else if (tk.type === "paragraph" || tk.type === "text") {
      const text = "text" in tk ? String((tk as { text: unknown }).text) : "";
      if (text) out.push(<Text key={key++} color={t.fg} wrap="wrap">{text}</Text>);
    }
  }
  return out;
}

function Message({ msg, frame }: { msg: ChatMessage; frame: number }) {
  if (msg.role === "user") {
    return <Text backgroundColor={t.selectionBg} color={t.overlayFg} wrap="wrap">► {msg.content}</Text>;
  }
  if (msg.role === "assistant") {
    return (
      <Box flexDirection="column">
        <Box><Text color={t.role.assistant}>{msg.streaming ? SPIN[frame % SPIN.length] : "⏺"}</Text>
          {msg.usage && <Text color={t.dim}>  {msg.usage.input}+{msg.usage.output}tok</Text>}</Box>
        {msg.content && <Box paddingLeft={2} flexDirection="column">{renderMd(msg.content)}</Box>}
        {msg.toolCalls?.map(tc => <Box key={tc.id} paddingLeft={2}><ToolCard tool={tc} frame={frame} /></Box>)}
        <Text color={t.border}>{"─".repeat(40)}</Text>
      </Box>
    );
  }
  return <Text backgroundColor={t.overlayBg} color={t.dim}>▣ {msg.content}</Text>;
}

export function ChatView({ messages, frame, maxRows, offset }: { messages: ChatMessage[]; frame: number; maxRows: number; offset: number }) {
  if (messages.length === 0) {
    return <Box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
      <Text color={t.dim}>输入消息开始对话</Text>
      <Text color={t.dim}>Ctrl+K 命令 · Ctrl+G 外部编辑器</Text>
    </Box>;
  }
  const N = Math.max(4, Math.floor((maxRows || 12) / 2));
  const end = Math.max(1, messages.length - offset);
  const start = Math.max(0, end - N);
  const visible = messages.slice(start, end);
  return (
    <Box flexDirection="column" flexGrow={1}>
      {start > 0 && <Text color={t.dim}>▲ {start} 条</Text>}
      {visible.map(m => <Message key={m.id} msg={m} frame={frame} />)}
      {offset > 0 && <Text color={t.accent}>▼ 最新</Text>}
    </Box>
  );
}
