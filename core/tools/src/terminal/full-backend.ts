/**
 * Rust terminal-engine 的 TerminalBackend 包装。
 * 只在 tryCreateFullBackend() 被调用时 createRequire 原生模块；
 * 显式 mini 路径不会调用本函数。
 */

import { createRequire } from "node:module";
import type {
  FilterConfig,
  OpenInteractiveOpts,
  RunResult,
  SandboxConfig,
  TerminalBackend,
  TerminalInfo,
  TerminalStreamEvent,
} from "./backend.js";

type RustEngine = {
  isNativeAvailable: boolean;
  hasResize?: boolean;
  hasSubscribe?: boolean;
  hasOpenInteractive?: boolean;
  initEngine: (logDir?: string) => void;
  setPersistPath: (path: string) => void;
  run: (
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    timeoutMs?: number,
    resultLimit?: number,
  ) => Promise<RunResult>;
  runBackground: (
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    id?: string,
  ) => Promise<RunResult>;
  write: (id: string, agentName: string, data: string) => Promise<void>;
  stop: (id: string, agentName: string) => Promise<void>;
  logs: (id: string, agentName: string, lines?: number) => Promise<string>;
  list: (agentName?: string) => TerminalInfo[];
  remove: (id: string, agentName: string) => Promise<void>;
  cleanupAgent: (agentName: string) => void;
  shutdown: () => void;
  setFilter: (config: Record<string, unknown>) => void;
  setSandbox: (config: Record<string, unknown>) => void;
  statusPanel: (agentName: string) => string;
  resize?: (id: string, cols: number, rows: number) => void | Promise<void>;
  subscribe?: (id: string, onEvent: (ev: TerminalStreamEvent) => void) => () => void;
  openInteractive?: (opts: OpenInteractiveOpts) => Promise<string | { id: string }>;
};

const require = createRequire(import.meta.url);

let nativeProbed = false;
let cachedFull: TerminalBackend | null = null;

export function nativeWasProbed(): boolean {
  return nativeProbed;
}

export function tryCreateFullBackend(): TerminalBackend | null {
  if (cachedFull) return cachedFull;
  nativeProbed = true;
  try {
    const engine = require("@little-house-studio/terminal-engine") as RustEngine;
    cachedFull = tryCreateFullBackendFromEngine(engine);
    return cachedFull;
  } catch {
    return null;
  }
}

function tryCreateFullBackendFromEngine(engine: RustEngine): TerminalBackend | null {
  if (!engine?.isNativeAvailable) return null;
  return new FullBackend(engine);
}

export function resetFullBackendProbeForTest(): void {
  nativeProbed = false;
  cachedFull = null;
}

class FullBackend implements TerminalBackend {
  readonly kind = "full" as const;
  constructor(private readonly engine: RustEngine) {}

  initEngine(logDir?: string): void {
    this.engine.initEngine(logDir);
  }

  setPersistPath(path: string): void {
    this.engine.setPersistPath(path);
  }

  run(
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    timeoutMs?: number,
    resultLimit?: number,
  ): Promise<RunResult> {
    return this.engine.run(agentName, command, cwd, description, timeoutMs, resultLimit);
  }

  runBackground(
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    id?: string,
  ): Promise<RunResult> {
    return this.engine.runBackground(agentName, command, cwd, description, id);
  }

  write(id: string, agentName: string, data: string): Promise<void> {
    return this.engine.write(id, agentName, data);
  }

  stop(id: string, agentName: string): Promise<void> {
    return this.engine.stop(id, agentName);
  }

  logs(id: string, agentName: string, lines?: number): Promise<string> {
    return this.engine.logs(id, agentName, lines);
  }

  list(agentName?: string): TerminalInfo[] {
    const raw = this.engine.list(agentName) ?? [];
    return raw.map((t) => ({
      ...t,
      kind: t.kind ?? (t.id.startsWith("human_") ? "human" : "agent"),
    }));
  }

  remove(id: string, agentName: string): Promise<void> {
    return this.engine.remove(id, agentName);
  }

  cleanupAgent(agentName: string): void {
    this.engine.cleanupAgent(agentName);
  }

  shutdown(): void {
    this.engine.shutdown();
  }

  setFilter(config: FilterConfig): void {
    this.engine.setFilter({
      presetBlacklistEnabled: config.presetBlacklistEnabled,
      preset_blacklist_enabled: config.presetBlacklistEnabled,
      blacklist: config.blacklist,
      whitelist: config.whitelist,
      whitelistMode: config.whitelistMode,
      whitelist_mode: config.whitelistMode,
    });
  }

  setSandbox(config: SandboxConfig): void {
    this.engine.setSandbox({
      enabled: config.enabled,
      allowedPaths: config.allowedPaths,
      allowed_paths: config.allowedPaths,
      deniedPaths: config.deniedPaths,
      denied_paths: config.deniedPaths,
      injectPrompt: config.injectPrompt,
      inject_prompt: config.injectPrompt,
      promptText: config.promptText,
      prompt_text: config.promptText,
    });
  }

  statusPanel(agentName: string): string {
    return this.engine.statusPanel(agentName);
  }

  async resize(id: string, cols: number, rows: number): Promise<void> {
    if (!this.engine.hasResize || typeof this.engine.resize !== "function") {
      throw new Error("当前 terminal-engine .node 不支持 resize，请更新预编译");
    }
    await this.engine.resize(id, cols, rows);
  }

  subscribe(id: string, onEvent: (ev: TerminalStreamEvent) => void): () => void {
    if (!this.engine.hasSubscribe || typeof this.engine.subscribe !== "function") {
      return () => {};
    }
    return this.engine.subscribe(id, onEvent);
  }

  async openInteractive(opts: OpenInteractiveOpts): Promise<{ id: string }> {
    if (!this.engine.hasOpenInteractive || typeof this.engine.openInteractive !== "function") {
      throw new Error("当前 terminal-engine .node 不支持 openInteractive，请更新预编译");
    }
    const raw = await this.engine.openInteractive(opts);
    const id = typeof raw === "string" ? raw : raw.id;
    return { id };
  }
}
