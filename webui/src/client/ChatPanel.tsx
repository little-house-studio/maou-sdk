import { useCallback, useEffect, useRef, useState } from "react";
import { abortChat, streamChat, type StreamEvent } from "./api";

export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  err?: boolean;
  /** use_terminal 会话，可点开右侧 */
  terminalId?: string;
  agentName?: string;
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function extractTerminalId(ev: StreamEvent): string | undefined {
  const payload = ev.payload as { terminal_id?: string; terminalId?: string } | undefined;
  if (payload?.terminal_id) return String(payload.terminal_id);
  if (payload?.terminalId) return String(payload.terminalId);
  // tool 对象 / 结果里常见字段
  const tool = ev.tool as { result?: { payload?: { terminal_id?: string } } } | undefined;
  if (tool?.result?.payload?.terminal_id) {
    return String(tool.result.payload.terminal_id);
  }
  if (typeof ev.terminal_id === "string") return ev.terminal_id;
  // 文本兜底（use_terminal 正文常含「终端 ID: xxx」或 [terminal_id=bg_…]）
  const content = String(ev.content ?? ev.message ?? ev.result ?? "");
  const m =
    content.match(/\[?terminal_id[=:]\s*([^\s|,}\]]+)/i) ||
    content.match(/终端\s*ID[:：]\s*(\S+)/i) ||
    content.match(/\b(bg_\d+)\b/);
  return m?.[1];
}

type Props = {
  onOpenTerminal?: (id: string, agentName?: string) => void;
  defaultAgent?: string;
};

export function ChatPanel({ onOpenTerminal, defaultAgent = "coding" }: Props) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const append = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const patchLastAssistant = useCallback((delta: string) => {
    setLines((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]!.role === "assistant") {
          next[i] = { ...next[i]!, text: next[i]!.text + delta };
          return next;
        }
      }
      next.push({ id: uid(), role: "assistant", text: delta });
      return next;
    });
  }, []);

  const onEvent = useCallback(
    (ev: StreamEvent) => {
      switch (ev.type) {
        case "assistant_delta":
        case "text_delta": {
          const d = String(ev.delta ?? ev.content ?? "");
          if (d) patchLastAssistant(d);
          break;
        }
        case "assistant": {
          const content = String(ev.content ?? "");
          if (!content) break;
          setLines((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && !last.text) {
              next[next.length - 1] = { ...last, text: content };
              return next;
            }
            if (last?.role === "assistant" && content.startsWith(last.text)) {
              next[next.length - 1] = { ...last, text: content };
              return next;
            }
            next.push({ id: uid(), role: "assistant", text: content });
            return next;
          });
          break;
        }
        case "tool_call": {
          const tool = ev.tool as {
            name?: string;
            parameters?: Record<string, unknown>;
          } | undefined;
          const name =
            tool?.name ?? String(ev.name ?? (ev as { tool_name?: string }).tool_name ?? "tool");
          const params = tool?.parameters ?? (ev.parameters as Record<string, unknown>) ?? {};
          const cmd = typeof params.command === "string" ? params.command : "";
          const desc =
            typeof params.description === "string" ? params.description : "";
          // 仅当显式传入 id（后台复用会话）时 tool_call 阶段就有 terminal id
          const tid =
            typeof params.id === "string"
              ? params.id
              : typeof params.terminal_id === "string"
                ? params.terminal_id
                : undefined;
          const isTerm = name === "use_terminal" || name === "bash";
          append({
            id: uid(),
            role: "tool",
            text: `▶ ${name}${desc ? ` · ${desc}` : ""}${cmd ? `\n$ ${cmd.slice(0, 120)}` : ""}`,
            terminalId: isTerm ? tid : undefined,
            agentName: defaultAgent,
          });
          break;
        }
        case "tool_result": {
          const name = String(
            ev.name ?? (ev as { tool_name?: string }).tool_name ?? "tool",
          );
          const ok = ev.ok !== false;
          const tid = extractTerminalId(ev);
          // 用 terminal_id 回填：即使 name 不是 use_terminal，有 id 也可点开
          append({
            id: uid(),
            role: "tool",
            text: `${ok ? "✓" : "✗"} ${name}${tid ? ` · ${tid}` : ""}`,
            err: !ok,
            terminalId: tid,
            agentName: defaultAgent,
          });
          break;
        }
        case "error":
          append({
            id: uid(),
            role: "system",
            text: String(ev.message ?? ev.error ?? "error"),
            err: true,
          });
          break;
        case "log": {
          const msg = String(ev.message ?? "");
          if (msg && (ev.level === "error" || ev.level === "warning")) {
            append({
              id: uid(),
              role: "system",
              text: msg,
              err: ev.level === "error",
            });
          }
          break;
        }
        default:
          break;
      }
    },
    [append, patchLastAssistant, defaultAgent],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    append({ id: uid(), role: "user", text });
    append({ id: uid(), role: "assistant", text: "" });
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      for await (const ev of streamChat(text, ac.signal)) {
        onEvent(ev);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        append({
          id: uid(),
          role: "system",
          text: e instanceof Error ? e.message : String(e),
          err: true,
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      setLines((prev) =>
        prev.filter((l) => !(l.role === "assistant" && !l.text.trim())),
      );
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">Chat</div>
      <div className="chat-log" ref={logRef}>
        {lines.length === 0 && (
          <div className="bubble system">
            输入消息开始。Agent 的 use_terminal 会出现在右侧列表；点击工具行可打开真实终端输出并交互。
          </div>
        )}
        {lines.map((l) => (
          <div
            key={l.id}
            className={`bubble ${l.role}${l.err ? " err" : ""}${l.role === "tool" ? " tool-line" : ""}${l.terminalId ? " clickable" : ""}`}
            onClick={() => {
              if (l.terminalId && onOpenTerminal) {
                onOpenTerminal(l.terminalId, l.agentName);
              }
            }}
            title={l.terminalId ? `打开终端 ${l.terminalId}` : undefined}
          >
            <div className="tag">
              {l.role}
              {l.terminalId ? " · 点击打开终端" : ""}
            </div>
            {l.text || (busy && l.role === "assistant" ? "…" : "")}
          </div>
        ))}
      </div>
      <div className="composer">
        <textarea
          value={input}
          placeholder="消息…（Enter 发送 · Shift+Enter 换行）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy}
        />
        {busy ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              abortRef.current?.abort();
              void abortChat();
            }}
          >
            停止
          </button>
        ) : (
          <button type="button" onClick={() => void send()} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </div>
  );
}
