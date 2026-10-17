import React, { useEffect, useRef, useState } from "react";
import { isDarwinChrome } from "../../desktop-chrome";
import type { UiMode } from "../types";
import { MaouLogo } from "../icons/MaouLogo";
import {
  formatTodayInArrow,
  formatTodayOutArrow,
  formatTodayTokenTitle,
} from "./today-tokens";
import {
  activityRowLabel,
  summarizeActivityChip,
  type ActivityAgentItem,
} from "./activity-agents";

export type { ActivityAgentItem };

export type WireTopbarProps = {
  mode: UiMode;
  onModeChange: (m: UiMode) => void;
  todayInput: number;
  todayOutput: number;
  activityAgents?: ActivityAgentItem[];
  onSelectActivityAgent?: (switchId: string) => void;
};

const MODES: { id: UiMode; label: string }[] = [
  { id: "chat", label: "聊天" },
  { id: "project", label: "项目" },
  { id: "plugins", label: "插件" },
  { id: "settings", label: "设置" },
];

/** 顶栏：左 logo + 活动 Agent · 中模式页签 · 右今日 ↑in ↓out */
export function WireTopbar({
  mode,
  onModeChange,
  todayInput,
  todayOutput,
  activityAgents = [],
  onSelectActivityAgent,
}: WireTopbarProps) {
  const darwinChrome = isDarwinChrome();
  const inn = Number.isFinite(todayInput) ? todayInput : 0;
  const out = Number.isFinite(todayOutput) ? todayOutput : 0;
  return (
    <header
      className={`wire-topbar${darwinChrome ? " is-darwin-chrome" : ""}`}
      data-tauri-drag-region={darwinChrome ? "deep" : undefined}
    >
      <div className="wire-topbar-left">
        <span className="wire-wordmark" title="Maou CLI brand">
          <MaouLogo compact />
        </span>
        {onSelectActivityAgent ? (
          <ActivityAgentCrumb
            items={activityAgents}
            onSelect={onSelectActivityAgent}
          />
        ) : null}
      </div>

      <nav
        className="wire-mode-tabs"
        role="tablist"
        aria-label="界面模式"
        data-tauri-drag-region={darwinChrome ? "false" : undefined}
      >
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
          <span className="wire-today-kicker">今日</span>
          <span className="wire-today-io">
            <span className="wire-today-in">{formatTodayInArrow(inn)}</span>
            <span className="wire-today-out">{formatTodayOutArrow(out)}</span>
          </span>
        </span>
      </div>
    </header>
  );
}

function ActivityAgentCrumb({
  items,
  onSelect,
}: {
  items: ActivityAgentItem[];
  onSelect: (switchId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chip = summarizeActivityChip(items);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      className="wire-agent-crumb"
      ref={rootRef}
      data-live={chip.live ? "true" : "false"}
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        className="wire-agent-crumb-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="活动 Agent"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`wire-agent-crumb-dot${chip.live ? " is-live" : ""}`} />
        <span className="wire-agent-crumb-label">{chip.label}</span>
      </button>
      {open ? (
        <ul className="wire-agent-crumb-menu" role="listbox" aria-label="可切换 Agent">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={Boolean(item.current)}
                className={item.current ? "is-current" : ""}
                data-status={item.status}
                onClick={() => {
                  setOpen(false);
                  onSelect(item.switchId);
                }}
              >
                {activityRowLabel(item)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
