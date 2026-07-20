/**
 * 文档 Copilot 面板 — 独立 agent 会话（doc-copilot）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffLine } from "../parser";
import {
  abortCopilotChat,
  fetchCopilotMeta,
  newCopilotSession,
  streamCopilotChat,
} from "../api-copilot";

export type CopilotPanelProps = {
  projectHint?: string;
  /** 当前打开文件路径（相对项目） */
  filePath?: string | null;
  /** 当前正文，发给 agent 作上下文 */
  documentContent?: string;
  /** 批注汇总 */
  annotations?: string;
  pendingDiff?: DiffLine[];
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  /** 工具改文件后刷新编辑器 */
  onDocMaybeChanged?: () => void;
};

type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  err?: boolean;
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function CopilotPanel({
  projectHint,
  filePath,
  documentContent,
  annotations,
  pendingDiff = [],
  onAcceptAll,
  onRejectAll,
  onDocMaybeChanged,
}: CopilotPanelProps) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<string>("");
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetchCopilotMeta()
      .then((m) => {
        setMeta(`${m.agentName} · ${m.provider}/${m.model}`);
      })
      .catch(() => setMeta("doc-copilot"));
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, busy]);

  const append = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const patchAssistant = useCallback((delta: string) => {
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

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    if (!override) setInput("");
    append({ id: uid(), role: "user", text });
    append({ id: uid(), role: "assistant", text: "" });
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let sawTool = false;
    try {
      for await (const ev of streamCopilotChat(
        {
          message: text,
          filePath,
          content: documentContent,
          annotations,
        },
        ac.signal,
      )) {
        switch (ev.type) {
          case "assistant_delta":
          case "text_delta": {
            const d = String(ev.delta ?? ev.content ?? "");
            if (d) patchAssistant(d);
            break;
          }
          case "assistant": {
            const c = String(ev.content ?? "");
            if (c) {
              setLines((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = {
                    ...last,
                    text: c.startsWith(last.text) ? c : last.text + c,
                  };
                  return next;
                }
                next.push({ id: uid(), role: "assistant", text: c });
                return next;
              });
            }
            break;
          }
          case "tool_call": {
            sawTool = true;
            const tool = ev.tool as { name?: string } | undefined;
            const name = tool?.name ?? String(ev.name ?? "tool");
            append({
              id: uid(),
              role: "tool",
              text: `▶ ${name}`,
            });
            break;
          }
          case "tool_result": {
            sawTool = true;
            const name = String(ev.name ?? "tool");
            const ok = ev.ok !== false;
            append({
              id: uid(),
              role: "tool",
              text: `${ok ? "✓" : "✗"} ${name}`,
              err: !ok,
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
          default:
            break;
        }
      }
      if (sawTool) onDocMaybeChanged?.();
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

  const hasDiff = pendingDiff.some((d) => d.type !== "equal");

  return (
    <aside className="md-copilot">
      <div className="md-copilot-head">
        <div className="md-copilot-head-row">
          <span className="md-copilot-brand">Copilot</span>
          <button
            type="button"
            className="linkish"
            title="新开会话"
            onClick={() => {
              void newCopilotSession().then(() => {
                setLines([]);
                setMeta((m) => m);
              });
            }}
          >
            新会话
          </button>
        </div>
        <span className="md-copilot-sub">
          {meta || "doc-copilot"} · 项目级
        </span>
        {filePath ? (
          <span className="md-copilot-file" title={filePath}>
            📄 {filePath}
          </span>
        ) : null}
      </div>

      <div className="md-copilot-body" ref={logRef}>
        {lines.length === 0 && (
          <div className="md-copilot-card">
            <p>
              文档助手已接入独立 Agent（<code>doc-copilot</code>
              ）。可读写项目 Markdown、终端与搜索。
            </p>
            <p className="muted">
              试试：<code>/goal 补全验收标准</code> 或「细化当前文档的登录需求」
            </p>
            {projectHint ? (
              <p className="muted">cwd: {projectHint}</p>
            ) : null}
          </div>
        )}

        {lines.map((l) => (
          <div
            key={l.id}
            className={`md-copilot-msg ${l.role}${l.err ? " err" : ""}`}
          >
            <div className="md-copilot-msg-role">{l.role}</div>
            <div className="md-copilot-msg-text">
              {l.text || (busy && l.role === "assistant" ? "…" : "")}
            </div>
          </div>
        ))}

        {hasDiff ? (
          <div className="md-copilot-diff">
            <div className="md-copilot-diff-title">待审改动（本地 diff）</div>
            <pre className="md-copilot-diff-view">
              {pendingDiff
                .filter((d) => d.type !== "equal")
                .slice(0, 80)
                .map((d, i) => (
                  <div
                    key={i}
                    className={
                      d.type === "add"
                        ? "diff-add"
                        : d.type === "del"
                          ? "diff-del"
                          : ""
                    }
                  >
                    {d.type === "add" ? "+" : d.type === "del" ? "-" : " "}
                    {d.text}
                  </div>
                ))}
            </pre>
          </div>
        ) : null}
      </div>

      <div className="md-copilot-composer">
        <textarea
          className="md-copilot-input"
          rows={2}
          placeholder="与文档 Copilot 对话…（Enter 发送 · Shift+Enter 换行）"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="md-btn"
            onClick={() => {
              abortRef.current?.abort();
              void abortCopilotChat();
            }}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            className="md-btn primary"
            disabled={!input.trim()}
            onClick={() => void send()}
          >
            发送
          </button>
        )}
      </div>

      <div className="md-copilot-foot">
        <button
          type="button"
          className="md-btn"
          disabled={!hasDiff}
          onClick={onAcceptAll}
        >
          全部同意
        </button>
        <button
          type="button"
          className="md-btn"
          disabled={!hasDiff}
          onClick={onRejectAll}
        >
          全部放弃
        </button>
        <button
          type="button"
          className="md-btn primary"
          disabled={busy}
          onClick={() => void send(input.trim() || "请继续")}
        >
          继续聊
        </button>
      </div>
    </aside>
  );
}
