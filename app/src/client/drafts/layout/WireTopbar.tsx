import React from "react";
import type { DraftMeta, UiMode } from "../types";
import { MaouLogo } from "../icons/MaouLogo";

export type WireTopbarProps = {
  mode: UiMode;
  onModeChange: (m: UiMode) => void;
  meta: DraftMeta;
  usageLabel: string;
};

const MODES: { id: UiMode; label: string }[] = [
  { id: "chat", label: "聊天" },
  { id: "project", label: "项目" },
  { id: "team", label: "Team" },
  { id: "settings", label: "设置" },
];

/** 顶栏：左 logo · 中模式页签 · 右 meta */
export function WireTopbar({
  mode,
  onModeChange,
  meta,
  usageLabel,
}: WireTopbarProps) {
  const darwinChrome =
    typeof navigator !== "undefined" &&
    /Electron/i.test(navigator.userAgent) &&
    /Mac/i.test(navigator.userAgent);
  return (
    <header className={`wire-topbar${darwinChrome ? " is-darwin-chrome" : ""}`}>
      <div className="wire-topbar-left">
        <span className="wire-wordmark" title="Maou CLI brand">
          <MaouLogo compact />
        </span>
      </div>

      <nav className="wire-mode-tabs" role="tablist" aria-label="界面模式">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={mode === m.id ? "active" : ""}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>

      <div className="wire-topbar-right">
        <span
          className={`wire-meta${meta.offline ? " is-off" : ""}`}
          title={`${meta.provider || "—"} / ${meta.model || "—"} · ${usageLabel}`}
        >
          <span className="wire-meta-model">
            {meta.model || meta.provider || "离线"}
          </span>
          <span className="wire-meta-dim">{usageLabel}</span>
        </span>
      </div>
    </header>
  );
}
