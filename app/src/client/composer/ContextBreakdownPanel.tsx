import React from "react";
import type { ContextBreakdown } from "./types";

export const CONTEXT_METER_HOVER_MS = 100;

export function fallbackContextBreakdown(input: {
  used?: number | null;
  max?: number | null;
  pct?: number | null;
}): ContextBreakdown | null {
  const max = input.max != null && input.max > 0 ? input.max : 0;
  const used =
    input.used != null && input.used >= 0
      ? input.used
      : max > 0 && input.pct != null
        ? Math.round((input.pct / 100) * max)
        : 0;
  if (max <= 0 && used <= 0 && input.pct == null) return null;
  const window = max > 0 ? max : Math.max(used, 0);
  const pct =
    input.pct ??
    (window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0);
  return {
    window,
    used,
    usedIsEstimate: true,
    promptTotal: used,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    occupancyPct: pct,
    cacheHitPct: null,
    system: 0,
    tools: 0,
    messages: used,
    overhead: 0,
    free: Math.max(0, window - used),
    toolCount: 0,
    skillCount: 0,
    mcpCount: 0,
    imageCount: 0,
  };
}

const ROWS = [
  { key: "system", label: "System", cls: "is-system" },
  { key: "tools", label: "Tools", cls: "is-tools" },
  { key: "messages", label: "Messages", cls: "is-messages" },
  { key: "overhead", label: "Overhead", cls: "is-overhead" },
  { key: "free", label: "Free", cls: "is-free" },
] as const;

function barShares(b: ContextBreakdown): Array<{ key: (typeof ROWS)[number]["key"]; width: number }> {
  const keys = ROWS.map((r) => r.key);
  if (b.used <= 0 && b.system + b.tools + b.messages <= 0) {
    return keys.map((key) => ({ key, width: key === "free" ? 100 : 0 }));
  }
  const window = b.window > 0 ? b.window : b.used + b.free;
  return keys.map((key) => ({
    key,
    width: window > 0 ? (b[key] / window) * 100 : 0,
  }));
}

function fmtTok(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function windowPct(tokens: number, window: number): string {
  if (window <= 0) return "—";
  return `${((tokens / window) * 100).toFixed(1)}%`;
}

export function ContextBreakdownPanel(props: {
  breakdown: ContextBreakdown;
  compact?: boolean;
}) {
  const b = props.breakdown;
  const window = b.window > 0 ? b.window : b.used + b.free;
  const used = b.used;
  const pct = b.occupancyPct;
  const tilde = b.usedIsEstimate ? "~" : "";
  const widths = new Map(barShares(b).map((s) => [s.key, s.width]));
  const segs = ROWS.map((row) => ({
    ...row,
    tokens: b[row.key],
    width: widths.get(row.key) ?? 0,
  })).filter((s) => s.width > 0);

  return (
    <div
      className={`composer-meter-panel${props.compact ? " is-compact" : ""}`}
      data-context-breakdown=""
    >
      <div className="composer-meter-panel-head">
        <span className="composer-meter-panel-kicker">上下文</span>
        <span className="composer-meter-panel-pct">
          {tilde}
          {pct}%
        </span>
        <span className="composer-meter-panel-fig">
          {tilde}
          {fmtTok(used)} / {fmtTok(window || used)}
        </span>
      </div>
      <div className="composer-meter-bar" aria-hidden>
        {segs.length === 0 ? (
          <div className="composer-meter-seg is-free" style={{ width: "100%" }} />
        ) : (
          segs.map((s) => (
            <div
              key={s.key}
              className={`composer-meter-seg ${s.cls}`}
              style={{ width: `${s.width}%` }}
            />
          ))
        )}
      </div>
      <dl className="composer-meter-rows">
        {ROWS.map((row) => (
          <div key={row.key} className="composer-meter-row">
            <dt>
              <span className={`composer-meter-swatch ${row.cls}`} aria-hidden />
              {row.label}
              {row.key === "tools" && b.toolCount > 0 ? (
                <span className="composer-meter-muted"> · {b.toolCount}</span>
              ) : null}
              {row.key === "messages" && b.imageCount > 0 ? (
                <span className="composer-meter-muted"> · {b.imageCount} 图</span>
              ) : null}
            </dt>
            <dd>
              {fmtTok(b[row.key])}
              <span className="composer-meter-muted">
                {" "}
                {windowPct(b[row.key], window)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {b.cacheHitPct != null ? (
        <div className="composer-meter-note">
          缓存命中 {b.cacheHitPct}%
          <span className="composer-meter-muted">
            {" "}
            · {fmtTok(b.cacheRead)} ⊂ prompt
          </span>
        </div>
      ) : null}
      <div className="composer-meter-note">
        {b.usedIsEstimate
          ? "占用含本地估算（还没有厂商回报，或回报之后又加了消息）。"
          : "System + Tools + Messages 是启发式分段，加总对不齐官方 usage 总数。"}
      </div>
      {b.skillCount > 0 || b.mcpCount > 0 ? (
        <div className="composer-meter-note">
          {b.skillCount > 0 ? `Skills ${b.skillCount}` : null}
          {b.skillCount > 0 && b.mcpCount > 0 ? " · " : null}
          {b.mcpCount > 0 ? `MCP ${b.mcpCount}` : null}
        </div>
      ) : null}
    </div>
  );
}
