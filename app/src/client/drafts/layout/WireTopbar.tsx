import React from "react";
import type { DraftMeta, UiMode } from "../types";
import { chromeMarkForMode } from "../visual-marks";
import { ChromeMark } from "../icons/Marks";
import { MaouLogo } from "../icons/MaouLogo";
import { LedStrip } from "./LedStrip";
import { resolveLedState } from "./led-strip";

export type WireTopbarProps = {
  mode: UiMode;
  onModeChange: (m: UiMode) => void;
  meta: DraftMeta;
  usageLabel: string;
  showFiles: boolean;
  onToggleFiles: () => void;
  /** Agent 是否在跑 — 驱动顶栏 3×18 LED */
  agentBusy?: boolean;
};

const MODES: { id: UiMode; label: string }[] = [
  { id: "chat", label: "聊天" },
  { id: "project", label: "项目" },
  { id: "team", label: "Team" },
  { id: "settings", label: "设置" },
];

/** 顶栏：CLI logo + 模式（含设置）+ 右侧 meta / 文件 */
export function WireTopbar({
  mode,
  onModeChange,
  meta,
  usageLabel,
  showFiles,
  onToggleFiles,
  agentBusy = false,
}: WireTopbarProps) {
  const led = resolveLedState({
    busy: agentBusy,
    offline: meta.offline,
  });
  return (
    <header className="wire-topbar">
      <div className="wire-topbar-left">
        <span className="wire-wordmark" title="Maou CLI brand">
          <MaouLogo compact />
        </span>
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
              <ChromeMark kind={chromeMarkForMode(m.id)} size={13} decorative />
              {m.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="wire-topbar-center">
        <LedStrip state={led} />
      </div>

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
        <button
          type="button"
          className={`wire-text-btn${showFiles ? " on" : ""}`}
          onClick={onToggleFiles}
        >
          <ChromeMark kind="files" size={14} decorative />
          文件
        </button>
      </div>
    </header>
  );
}
