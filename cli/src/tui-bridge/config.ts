/**
 * TUI 后端选择：ratatui | ink
 *
 * 优先级：CLI flag > MAOU_TUI env > ~/.maou/config.json cli.tui >
 *   win32 → ink；其它 → ratatui
 */

import { existsSync, readFileSync } from "node:fs";
import { userConfigPath } from "../config/paths.js";

export type TuiBackend = "ink" | "ratatui";

/**
 * Ratatui 是否正在占用 TTY（alternate screen + 双缓冲）。
 * Node 侧禁止对此写 CSI 清屏 / 视口复位，否则会花屏。
 * 运行时以 MAOU_TUI_ACTIVE 为准（bridge 启动时设置）。
 */
export function isRatatuiBackend(): boolean {
  const active = (process.env.MAOU_TUI_ACTIVE || "").toLowerCase();
  if (active === "ratatui" || active === "rust" || active === "rt") return true;
  const v = (process.env.MAOU_TUI || "").toLowerCase();
  return v === "ratatui" || v === "rust" || v === "rt";
}

/** 标记当前进程由 Ratatui 持有 TTY（须在任何可能写 stdout CSI 之前调用） */
export function markRatatuiActive(): void {
  process.env.MAOU_TUI_ACTIVE = "ratatui";
  if (!process.env.MAOU_TUI) process.env.MAOU_TUI = "ratatui";
}

export function resolveTuiBackend(flag?: string | null): TuiBackend {
  const fromFlag = normalize(flag);
  if (fromFlag) return fromFlag;

  const fromEnv = normalize(process.env.MAOU_TUI);
  if (fromEnv) return fromEnv;

  const fromCfg = readConfigTui();
  if (fromCfg) return fromCfg;

  return "ratatui";
}

function normalize(v: string | null | undefined): TuiBackend | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "ink" || s === "react" || s === "default") return "ink";
  if (s === "ratatui" || s === "rust" || s === "rt") return "ratatui";
  return null;
}

function readConfigTui(): TuiBackend | null {
  try {
    const p = userConfigPath();
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    // 支持 cli.tui 或顶层 tui
    const cli = raw.cli;
    if (cli && typeof cli === "object" && cli !== null) {
      const t = normalize(String((cli as Record<string, unknown>).tui ?? ""));
      if (t) return t;
    }
    return normalize(String(raw.tui ?? ""));
  } catch {
    return null;
  }
}
