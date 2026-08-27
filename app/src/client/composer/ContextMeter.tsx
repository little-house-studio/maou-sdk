import React from "react";
import type { ComposerProps } from "./types";

const R = 5.5;
const C = 2 * Math.PI * R;

export function ContextMeter(props: ComposerProps) {
  const pct = props.contextPct ?? 0;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * C;
  const label =
    props.contextPct != null ? `上下文 ${props.contextPct}%` : "上下文";
  const short = props.contextPct != null ? `${props.contextPct}%` : "—";
  return (
    <button
      type="button"
      className="composer-meter usage-chip wire-composer-usage"
      title={label}
      onClick={() => props.onUsageClick?.()}
    >
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
        <circle className="composer-meter-track" cx="7" cy="7" r={R} />
        <circle
          className="composer-meter-fill"
          cx="7"
          cy="7"
          r={R}
          strokeDasharray={`${dash} ${C}`}
          transform="rotate(-90 7 7)"
        />
      </svg>
      <span className="composer-meter-label">{short}</span>
    </button>
  );
}
