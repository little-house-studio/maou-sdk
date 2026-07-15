/**
 * TUI 后端选择：ink（默认，现网）| ratatui（可选新后端）
 *
 * 优先级：CLI flag > MAOU_TUI env > ~/.maou/config.json cli.tui > ink
 */

import { existsSync, readFileSync } from "node:fs";
import { userConfigPath } from "../config/paths.js";

export type TuiBackend = "ink" | "ratatui";

export function resolveTuiBackend(flag?: string | null): TuiBackend {
  const fromFlag = normalize(flag);
  if (fromFlag) return fromFlag;

  const fromEnv = normalize(process.env.MAOU_TUI);
  if (fromEnv) return fromEnv;

  const fromCfg = readConfigTui();
  if (fromCfg) return fromCfg;

  return "ink";
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
