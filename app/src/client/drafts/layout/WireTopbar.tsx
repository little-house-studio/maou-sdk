import React from "react";
import type { UiMode } from "../types";
import { MaouLogo } from "../icons/MaouLogo";
import {
  formatTodayTokenLine,
  formatTodayTokenTitle,
} from "./today-tokens";

export type WireTopbarProps = {
  mode: UiMode;
  onModeChange: (m: UiMode) => void;
  todayInput: number;
  todayOutput: number;
};

const MODES: { id: UiMode; label: string }[] = [
  { id: "chat", label: "聊天" },
  { id: "project", label: "项目" },
  { id: "team", label: "Team" },
  { id: "settings", label: "设置" },
];

/** 顶栏：左 logo · 中模式页签 · 右今日 in/out 一行字 */
export function WireTopbar({
  mode,
  onModeChange,
  todayInput,
  todayOutput,
}: WireTopbarProps) {
  const darwinChrome =
    typeof navigator !== "undefined" &&
    /Electron/i.test(navigator.userAgent) &&
    /Mac/i.test(navigator.userAgent);
  const inn = Number.isFinite(todayInput) ? todayInput : 0;
  const out = Number.isFinite(todayOutput) ? todayOutput : 0;
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
          className="wire-meta wire-meta-today"
          title={formatTodayTokenTitle(inn, out)}
        >
          {formatTodayTokenLine(inn, out)}
        </span>
      </div>
    </header>
  );
}
