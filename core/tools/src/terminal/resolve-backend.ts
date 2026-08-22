/**
 * 终端后端选型：
 *   1. MAOU_TERMINAL=full|mini
 *   2. agent.json terminalMode（经 setAgentTerminalMode / opts）
 *   3. ~/.maou/config.json terminal.mode（默认 full）
 *
 * 显式 mini → 只走纯 Node，不探测 Rust。
 * full 且 .node 可用 → Rust；full 但没有 → 降级 mini。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveUserConfigPath } from "@little-house-studio/types";
import type { TerminalKind, TerminalResolution } from "./backend.js";
import { MiniBackend } from "./mini/engine.js";
import { resetFullBackendProbeForTest, tryCreateFullBackend } from "./full-backend.js";

export interface ResolveBackendOptions {
  agentTerminalMode?: string;
  env?: NodeJS.ProcessEnv;
  /** 测试注入，跳过读盘 */
  configMode?: TerminalKind;
  configPath?: string;
  /** 测试注入：覆盖 native 探测 */
  nativeAvailable?: boolean;
}

let agentOverride: TerminalKind | undefined;
let miniSingleton: MiniBackend | null = null;
let lastResolution: TerminalResolution | null = null;

export function setAgentTerminalMode(mode?: string): void {
  agentOverride = parseMode(mode);
}

function parseMode(v: unknown): TerminalKind | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "full" || s === "mini") return s;
  return undefined;
}

function readConfigTerminalMode(configPath?: string): TerminalKind | undefined {
  const p = configPath ?? resolveUserConfigPath();
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      terminal?: { mode?: unknown };
    };
    return parseMode(raw.terminal?.mode);
  } catch {
    return undefined;
  }
}

export function resolveConfiguredMode(opts?: ResolveBackendOptions): TerminalKind {
  const env = opts?.env ?? process.env;
  const fromEnv = parseMode(env.MAOU_TERMINAL);
  if (fromEnv) return fromEnv;
  const fromAgent = parseMode(opts?.agentTerminalMode) ?? agentOverride;
  if (fromAgent) return fromAgent;
  if (opts?.configMode) return opts.configMode;
  return readConfigTerminalMode(opts?.configPath) ?? "full";
}

function readConfigTerminalShell(configPath?: string): string | undefined {
  const p = configPath ?? resolveUserConfigPath();
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      terminal?: { shell?: unknown };
    };
    const s = raw.terminal?.shell;
    return typeof s === "string" && s.trim() ? s.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** 与 AgentRuntime 一致：`<projectRoot>/.maou/terminals.json` */
export function resolveTerminalPersistPath(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".maou", "terminals.json");
}

/** 切换项目后把已初始化的后端指到新的 persist 文件（不重建引擎）。 */
export function rebindTerminalPersist(projectRoot?: string): void {
  try {
    getActiveBackend().setPersistPath(resolveTerminalPersistPath(projectRoot));
  } catch {
    /* 引擎未就绪 */
  }
}

/** 人壳可执行：MAOU_SHELL → config.json terminal.shell → undefined（引擎用 $SHELL） */
export function resolveInteractiveShell(opts?: {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
}): string | undefined {
  const env = opts?.env ?? process.env;
  const fromEnv = env.MAOU_SHELL?.trim();
  if (fromEnv) return fromEnv;
  return readConfigTerminalShell(opts?.configPath);
}

function getMini(degradedFromFull: boolean): MiniBackend {
  if (!miniSingleton) miniSingleton = new MiniBackend();
  miniSingleton.degradedFromFull = degradedFromFull;
  return miniSingleton;
}

export function resolveTerminalBackend(opts?: ResolveBackendOptions): TerminalResolution {
  const requested = resolveConfiguredMode(opts);
  if (requested === "mini") {
    const backend = getMini(false);
    lastResolution = { backend, kind: "mini", degraded: false, requested: "mini" };
    return lastResolution;
  }

  let nativeOk: boolean;
  let full = null as ReturnType<typeof tryCreateFullBackend>;
  if (typeof opts?.nativeAvailable === "boolean") {
    nativeOk = opts.nativeAvailable;
    full = nativeOk ? tryCreateFullBackend() : null;
    if (nativeOk && !full) nativeOk = false;
  } else {
    full = tryCreateFullBackend();
    nativeOk = Boolean(full);
  }

  if (full && nativeOk) {
    lastResolution = { backend: full, kind: "full", degraded: false, requested: "full" };
    return lastResolution;
  }

  const backend = getMini(true);
  lastResolution = { backend, kind: "mini", degraded: true, requested: "full" };
  return lastResolution;
}

export function getActiveBackend(opts?: ResolveBackendOptions) {
  return resolveTerminalBackend(opts).backend;
}

export function getTerminalResolution(opts?: ResolveBackendOptions): TerminalResolution {
  return lastResolution ?? resolveTerminalBackend(opts);
}

/**
 * Windows：把 config.json `terminal.shell` 写进 `MAOU_SHELL`，供 Rust/mini Agent 与人壳同源。
 * 已有环境变量不覆盖。Unix 不写，以免改 Mac `$SHELL -c`。
 */
export function applyAgentShellEnv(opts?: {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
}): void {
  if (process.platform !== "win32") return;
  if (process.env.MAOU_SHELL?.trim()) return;
  const fromEnv = opts?.env?.MAOU_SHELL?.trim();
  if (fromEnv) {
    process.env.MAOU_SHELL = fromEnv;
    return;
  }
  const fromConfig = readConfigTerminalShell(opts?.configPath);
  if (fromConfig) process.env.MAOU_SHELL = fromConfig;
}

export function initActiveBackend(logDir?: string, persistPath?: string): void {
  applyAgentShellEnv();
  const resolved = resolveTerminalBackend();
  try {
    resolved.backend.initEngine(logDir);
    if (persistPath) resolved.backend.setPersistPath(persistPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (resolved.kind === "full") {
      console.warn(`[terminal] full 初始化失败，降级 mini: ${msg}`);
      const mini = getMini(true);
      mini.initEngine(logDir);
      lastResolution = { backend: mini, kind: "mini", degraded: true, requested: "full" };
    } else {
      console.warn(`[terminal] mini 初始化失败: ${msg}`);
    }
  }
}

export function shutdownActiveBackend(): void {
  try {
    lastResolution?.backend.shutdown();
  } catch {
    /* best effort */
  }
  try {
    miniSingleton?.shutdown();
  } catch {
    /* best effort */
  }
}

export function resetTerminalBackendForTest(): void {
  try {
    miniSingleton?.shutdown();
  } catch {
    /* ignore */
  }
  miniSingleton = null;
  lastResolution = null;
  agentOverride = undefined;
  resetFullBackendProbeForTest();
}
