/**
 * CLI UI 偏好 —— 结构化读写 ~/.maou/cli-ui.json
 *
 * 单一真相源：主题、Debug 显示、以及后续 UI 开关都落在这里。
 * 优先级（各字段可单独 override）：
 *   1) 环境变量（若定义）
 *   2) 本文件
 *   3) DEFAULTS
 *
 * Schema（可扩展，未知字段保留）：
 * {
 *   "version": 1,
 *   "theme": "tau-ceti",
 *   "perfHud": false,
 *   "mouseCapture": true
 * }
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { userMaouRoot } from "./paths.js";

export const CLI_UI_PREFS_VERSION = 1 as const;

/** 结构化 UI 偏好（持久化字段） */
export interface CliUiPrefs {
  version: number;
  /** 主题 id */
  theme: string;
  /** 右上角 Debug / PerfHud */
  perfHud: boolean;
  /** SGR 鼠标捕获（Terminal.app 与原生选字互斥） */
  mouseCapture: boolean;
}

export const CLI_UI_DEFAULTS: CliUiPrefs = {
  version: CLI_UI_PREFS_VERSION,
  /** 默认 Braun 灰阶 + 酸性机能（assets/themes/tau-ceti.json） */
  theme: "tau-ceti",
  perfHud: true,
  mouseCapture: true,
};

export function cliUiConfigPath(): string {
  return join(userMaouRoot(), "cli-ui.json");
}

function readRaw(): Record<string, unknown> {
  try {
    const p = cliUiConfigPath();
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, "utf-8")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeRaw(next: Record<string, unknown>): void {
  const p = cliUiConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf-8");
}

/** 读完整偏好（合并默认值；保留未知字段不在返回类型里） */
export function loadCliUiPrefs(): CliUiPrefs {
  const raw = readRaw();
  return {
    version:
      typeof raw.version === "number" ? raw.version : CLI_UI_PREFS_VERSION,
    theme:
      typeof raw.theme === "string" && raw.theme.trim()
        ? raw.theme.trim()
        : CLI_UI_DEFAULTS.theme,
    perfHud:
      typeof raw.perfHud === "boolean" ? raw.perfHud : CLI_UI_DEFAULTS.perfHud,
    mouseCapture:
      typeof raw.mouseCapture === "boolean"
        ? raw.mouseCapture
        : process.env.MAOU_MOUSE !== "0",
  };
}

/** 合并写入（保留未知键） */
export function saveCliUiPrefs(partial: Partial<CliUiPrefs>): CliUiPrefs {
  const raw = readRaw();
  const merged: Record<string, unknown> = {
    ...raw,
    version: CLI_UI_PREFS_VERSION,
  };
  if (partial.theme !== undefined) merged.theme = partial.theme;
  if (partial.perfHud !== undefined) merged.perfHud = partial.perfHud;
  if (partial.mouseCapture !== undefined) {
    merged.mouseCapture = partial.mouseCapture;
  }
  writeRaw(merged);
  return loadCliUiPrefs();
}

/** 单字段：文件里是否显式写过 perfHud（别名 getPreferredPerfHud） */
export function getStoredPerfHud(): boolean | null {
  const raw = readRaw();
  return typeof raw.perfHud === "boolean" ? raw.perfHud : null;
}

export function getPreferredPerfHud(): boolean | null {
  return getStoredPerfHud();
}

/**
 * PerfHud 启动默认：
 *   MAOU_PERF_HUD=0/false → 关；=1/true → 开
 *   否则 cli-ui.json.perfHud
 *   否则 DEFAULTS.perfHud
 */
export function resolvePerfHudDefault(): boolean {
  const env = process.env.MAOU_PERF_HUD;
  if (env === "0" || env === "false") return false;
  if (env === "1" || env === "true") return true;
  const stored = getStoredPerfHud();
  if (stored !== null) return stored;
  return CLI_UI_DEFAULTS.perfHud;
}

export function setPreferredPerfHud(on: boolean): void {
  saveCliUiPrefs({ perfHud: on });
}

export function getPreferredThemeId(): string {
  return loadCliUiPrefs().theme;
}

export function setPreferredThemeId(id: string): void {
  saveCliUiPrefs({ theme: id });
}

export function resolveMouseCaptureDefault(): boolean {
  if (process.env.MAOU_MOUSE === "0" || process.env.MAOU_MOUSE === "false") {
    return false;
  }
  if (process.env.MAOU_MOUSE === "1" || process.env.MAOU_MOUSE === "true") {
    return true;
  }
  return loadCliUiPrefs().mouseCapture;
}

export function setPreferredMouseCapture(on: boolean): void {
  saveCliUiPrefs({ mouseCapture: on });
}
