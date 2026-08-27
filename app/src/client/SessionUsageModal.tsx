/**
 * Session usage / context stats modal (wire shell).
 * Opened from the composer 「上下文」 chip — not dumped into the chat thread.
 */
import { useEffect } from "react";

export type SessionUsageStats = {
  messageCount: number;
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  lastInputTokens?: number;
  lastOutputTokens?: number;
  contextUsed?: number;
  file?: string;
};

export type SessionUsageModalProps = {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  stats: SessionUsageStats | null;
  /** Optional max context for % display */
  maxContext?: number | null;
  loading?: boolean;
  error?: string | null;
  /** Raw text fallback from API */
  rawText?: string | null;
};

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : "—";
}

function cacheHitPct(input: number, cacheRead: number): string | null {
  if (!input || input <= 0 || !cacheRead) return null;
  const pct = Math.min(100, Math.round((cacheRead / input) * 1000) / 10);
  return `${pct}%`;
}

export function SessionUsageModal({
  open,
  onClose,
  sessionId,
  stats,
  maxContext,
  loading,
  error,
  rawText,
}: SessionUsageModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hit = stats
    ? cacheHitPct(stats.inputTokens, stats.cacheRead)
    : null;
  const contextUsed =
    stats?.contextUsed != null && stats.contextUsed > 0
      ? stats.contextUsed
      : (stats?.lastInputTokens ?? 0) + (stats?.lastOutputTokens ?? 0);
  const ctxPct =
    stats && maxContext && maxContext > 0 && contextUsed > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((contextUsed / maxContext) * 100)),
        )
      : null;

  return (
    <div
      className="session-usage-modal-root"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="session-usage-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-usage-title"
      >
        <header className="session-usage-head">
          <h2 id="session-usage-title" className="session-usage-title">
            会话用量
          </h2>
          <button
            type="button"
            className="session-usage-close"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </header>

        <div className="session-usage-body">
          {loading ? (
            <p className="session-usage-hint">加载中…</p>
          ) : error ? (
            <p className="session-usage-error" role="alert">
              {error}
            </p>
          ) : stats ? (
            <>
              <section className="session-usage-section">
                <h3 className="session-usage-section-title">会话</h3>
                <dl className="session-usage-dl">
                  <div className="session-usage-row">
                    <dt>Session ID</dt>
                    <dd className="session-usage-mono" title={sessionId ?? ""}>
                      {sessionId || "—"}
                    </dd>
                  </div>
                  {stats.file ? (
                    <div className="session-usage-row">
                      <dt>文件</dt>
                      <dd className="session-usage-mono" title={stats.file}>
                        {stats.file}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              <section className="session-usage-section">
                <h3 className="session-usage-section-title">消息</h3>
                <dl className="session-usage-dl">
                  <div className="session-usage-row">
                    <dt>总计</dt>
                    <dd>{fmt(stats.messageCount)}</dd>
                  </div>
                  <div className="session-usage-row">
                    <dt>用户</dt>
                    <dd>{fmt(stats.userTurns)}</dd>
                  </div>
                  <div className="session-usage-row">
                    <dt>助手</dt>
                    <dd>{fmt(stats.assistantTurns)}</dd>
                  </div>
                  <div className="session-usage-row">
                    <dt>工具调用</dt>
                    <dd>{fmt(stats.toolCalls)}</dd>
                  </div>
                </dl>
              </section>

              <section className="session-usage-section">
                <h3 className="session-usage-section-title">Tokens</h3>
                <dl className="session-usage-dl">
                  <div className="session-usage-row">
                    <dt>输入 (in)</dt>
                    <dd>{fmt(stats.inputTokens)}</dd>
                  </div>
                  <div className="session-usage-row">
                    <dt>输出 (out)</dt>
                    <dd>{fmt(stats.outputTokens)}</dd>
                  </div>
                  <div className="session-usage-row">
                    <dt>缓存读 (cache_read)</dt>
                    <dd>{fmt(stats.cacheRead)}</dd>
                  </div>
                  {hit ? (
                    <div className="session-usage-row">
                      <dt>缓存命中率</dt>
                      <dd>
                        {hit}
                        <span className="session-usage-muted">
                          {" "}
                          · 约计（logged usage）
                        </span>
                      </dd>
                    </div>
                  ) : null}
                  {ctxPct != null && maxContext ? (
                    <div className="session-usage-row">
                      <dt>上下文占用</dt>
                      <dd>
                        {ctxPct}%
                        <span className="session-usage-muted">
                          {" "}
                          · {fmt(contextUsed)} / {fmt(maxContext)}
                          {" "}
                          （上一条 in {fmt(stats.lastInputTokens ?? 0)} + out{" "}
                          {fmt(stats.lastOutputTokens ?? 0)}）
                        </span>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            </>
          ) : rawText ? (
            <pre className="session-usage-raw">{rawText}</pre>
          ) : (
            <p className="session-usage-hint">暂无统计数据</p>
          )}
        </div>

        <footer className="session-usage-foot">
          <button type="button" className="session-usage-ok" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
