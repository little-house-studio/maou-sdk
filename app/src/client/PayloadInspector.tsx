/**
 * 轮次调试面板 —— 「这一轮发出去的 POST」/「这一轮收回来的内容（含 tool）」。
 *
 * 从用户方块编号 / 轮次圆编号点开。数据来自落盘账本 raw_request / raw_response，
 * 敏感 header 在 core/llm 侧已剔除。两个视图共用一套骨架：概要条 + 结构/原文两页。
 */
import React, { useEffect, useMemo, useState } from "react";
import type { PayloadDetail } from "./session-payloads";

export type PayloadInspectorProps = {
  open: boolean;
  onClose: () => void;
  /** request = 发出去的 POST；response = 收回来的内容 */
  view: "request" | "response";
  /** 面板标题左半：#3 提问 / 第 2 轮 */
  title: string;
  detail: PayloadDetail | null;
  loading?: boolean;
  error?: string | null;
};

function bytesLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function tokLabel(n: number | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function cacheLabel(detail: PayloadDetail | null): string {
  if (!detail) return "—";
  const { input, cacheRead, reported } = detail.usage;
  if (!reported || input <= 0) return "—";
  const pct = Math.round((cacheRead / input) * 1000) / 10;
  return `${pct}% · ${tokLabel(cacheRead)}`;
}

function stringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}

/** raw_request.messages 里一条消息的可读摘要 */
type WireMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  reasoning_content?: string;
};

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object") {
          const rec = c as Record<string, unknown>;
          if (typeof rec.text === "string") return rec.text;
          if (rec.type === "image_url" || rec.type === "image") return "[图片]";
          return stringify(rec);
        }
        return "";
      })
      .join("\n");
  }
  if (content == null) return "";
  return stringify(content);
}

function MetaStrip({ cells }: { cells: Array<[string, string]> }) {
  return (
    <dl className="payload-meta">
      {cells.map(([k, v]) => (
        <div key={k} className="payload-meta-cell">
          <dt>{k}</dt>
          <dd title={v}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1200);
    return () => window.clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="payload-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => setDone(false),
        );
      }}
    >
      {done ? "已复制" : label}
    </button>
  );
}

function WireMessageList({ messages }: { messages: WireMessage[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(
    messages.length ? messages.length - 1 : null,
  );
  if (messages.length === 0) {
    return <p className="payload-hint">请求体里没有 messages 数组。</p>;
  }
  return (
    <ol className="payload-msgs">
      {messages.map((m, i) => {
        const body = flattenContent(m.content);
        const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
        const open = openIdx === i;
        const chars = body.length + (calls.length ? stringify(calls).length : 0);
        return (
          <li
            key={`${m.role ?? "?"}-${i}`}
            className={`payload-msg${open ? " is-open" : ""}`}
            data-role={m.role ?? "unknown"}
          >
            <button
              type="button"
              className="payload-msg-head"
              onClick={() => setOpenIdx(open ? null : i)}
              aria-expanded={open}
            >
              <span className="payload-msg-idx">{i + 1}</span>
              <span className="payload-msg-role">{m.role ?? "unknown"}</span>
              <span className="payload-msg-size">{chars.toLocaleString()} 字符</span>
              {calls.length ? (
                <span className="payload-msg-tools">tool ×{calls.length}</span>
              ) : null}
              <span className="payload-msg-fold" aria-hidden>
                {open ? "▼" : "▶"}
              </span>
            </button>
            {open ? (
              <div className="payload-msg-body">
                {m.reasoning_content ? (
                  <pre className="payload-pre is-quiet">
                    {m.reasoning_content}
                  </pre>
                ) : null}
                {body ? <pre className="payload-pre">{body}</pre> : null}
                {calls.length ? (
                  <pre className="payload-pre is-tool">{stringify(calls)}</pre>
                ) : null}
                {!body && !calls.length ? (
                  <p className="payload-hint">（空内容）</p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function RequestView({ detail }: { detail: PayloadDetail }) {
  const req = detail.request;
  const body = (req?.body ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(body.messages)
    ? (body.messages as WireMessage[])
    : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const raw = useMemo(() => stringify(req), [req]);
  const [tab, setTab] = useState<"struct" | "raw">("struct");

  if (!req) {
    return (
      <p className="payload-hint">
        这一轮的账本里没有 raw_request —— 通常是这轮还没落盘，或会话来自不记录请求体的旧版本。
      </p>
    );
  }

  return (
    <>
      <MetaStrip
        cells={[
          ["模型", String(body.model ?? detail.model ?? "—")],
          ["端点", req.url ?? "—"],
          ["消息", String(messages.length)],
          ["工具", String(tools.length)],
          ["请求体", bytesLabel(req.bytes)],
          ["输入", `${tokLabel(detail.usage.input)} tok`],
          ["缓存命中", cacheLabel(detail)],
        ]}
      />
      <div className="payload-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "struct"}
          className={tab === "struct" ? "is-active" : ""}
          onClick={() => setTab("struct")}
        >
          消息 {messages.length}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "raw"}
          className={tab === "raw" ? "is-active" : ""}
          onClick={() => setTab("raw")}
        >
          原始 JSON
        </button>
        <CopyButton text={raw} label="复制请求体" />
      </div>
      {tab === "struct" ? (
        <WireMessageList messages={messages} />
      ) : (
        <pre className="payload-pre is-raw">{raw}</pre>
      )}
    </>
  );
}

function ResponseView({ detail }: { detail: PayloadDetail }) {
  const res = detail.response;
  const raw = useMemo(() => stringify(res), [res]);
  const [tab, setTab] = useState<"struct" | "raw">("struct");

  if (!res) {
    return (
      <p className="payload-hint">
        这一轮还没有落盘的返回内容 —— 轮次跑完后再点。
      </p>
    );
  }

  return (
    <>
      <MetaStrip
        cells={[
          ["模型", detail.model ?? "—"],
          ["停止原因", res.finishReason ?? "—"],
          ["工具调用", String(res.toolCalls.length)],
          ["返回体", bytesLabel(res.bytes)],
          ["输出", `${tokLabel(detail.usage.output)} tok`],
          ["输入", `${tokLabel(detail.usage.input)} tok`],
          ["缓存命中", cacheLabel(detail)],
        ]}
      />
      <div className="payload-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "struct"}
          className={tab === "struct" ? "is-active" : ""}
          onClick={() => setTab("struct")}
        >
          正文 + 工具
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "raw"}
          className={tab === "raw" ? "is-active" : ""}
          onClick={() => setTab("raw")}
        >
          原始 JSON
        </button>
        <CopyButton text={raw} label="复制返回体" />
      </div>
      {tab === "struct" ? (
        <div className="payload-sections">
          {res.validationError ? (
            <section className="payload-section is-err">
              <h4>错误</h4>
              <pre className="payload-pre">{res.validationError}</pre>
            </section>
          ) : null}
          {res.reasoning ? (
            <section className="payload-section">
              <h4>思考</h4>
              <pre className="payload-pre is-quiet">{res.reasoning}</pre>
            </section>
          ) : null}
          <section className="payload-section">
            <h4>正文</h4>
            {res.content ? (
              <pre className="payload-pre">{res.content}</pre>
            ) : (
              <p className="payload-hint">（本轮没有正文，只有工具调用）</p>
            )}
          </section>
          <section className="payload-section">
            <h4>工具调用 {res.toolCalls.length}</h4>
            {res.toolCalls.length ? (
              <ol className="payload-calls">
                {res.toolCalls.map((c, i) => (
                  <li key={`${String(c.id ?? i)}`} className="payload-call">
                    <div className="payload-call-head">
                      <span className="payload-msg-idx">{i + 1}</span>
                      <span className="payload-call-name">
                        {String(c.name ?? "?")}
                      </span>
                      <span className="payload-call-id">
                        {String(c.id ?? "")}
                      </span>
                    </div>
                    <pre className="payload-pre is-tool">
                      {stringify(c.arguments ?? c.parameters ?? {})}
                    </pre>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="payload-hint">（本轮没有工具调用）</p>
            )}
          </section>
        </div>
      ) : (
        <pre className="payload-pre is-raw">{raw}</pre>
      )}
    </>
  );
}

export function PayloadInspector({
  open,
  onClose,
  view,
  title,
  detail,
  loading,
  error,
}: PayloadInspectorProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const kindLabel = view === "request" ? "POST 请求" : "返回内容";

  return (
    <div
      className="payload-modal-root"
      role="presentation"
      data-payload-view={view}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="payload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payload-inspector-title"
      >
        <header className="payload-head">
          <h2 id="payload-inspector-title" className="payload-title">
            <span className="payload-title-k">{title}</span>
            <span className="payload-title-sep" aria-hidden>
              ·
            </span>
            <span className="payload-title-v">{kindLabel}</span>
          </h2>
          <button
            type="button"
            className="payload-close"
            onClick={onClose}
            aria-label="关闭"
            title="关闭（Esc）"
          >
            ×
          </button>
        </header>
        <div className="payload-body">
          {loading ? (
            <p className="payload-hint">读取账本中…</p>
          ) : error ? (
            <p className="payload-error" role="alert">
              {error}
            </p>
          ) : detail ? (
            view === "request" ? (
              <RequestView detail={detail} />
            ) : (
              <ResponseView detail={detail} />
            )
          ) : (
            <p className="payload-hint">没有找到这一轮的记录。</p>
          )}
        </div>
      </div>
    </div>
  );
}
