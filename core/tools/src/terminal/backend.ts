/**
 * 终端后端接口。full = Rust PTY；mini = 纯 Node 管道。
 * core/tools 不得依赖 core/agent。
 */

export type TerminalKind = "full" | "mini";

export interface RunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
  terminalId: string;
  error: string | null;
}

export interface TerminalInfo {
  id: string;
  agentName: string;
  command: string;
  description: string;
  state: string;
  exitCode: number | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  lastViewedAt?: string;
  kind?: "agent" | "human";
}

export function isHumanTerminal(t: { kind?: string; id: string }): boolean {
  return t.kind === "human" || t.id.startsWith("human_");
}

export interface FilterConfig {
  presetBlacklistEnabled: boolean;
  blacklist: string[];
  whitelist: string[];
  whitelistMode: boolean;
}

export interface SandboxConfig {
  enabled: boolean;
  allowedPaths: string[];
  deniedPaths: string[];
  injectPrompt: boolean;
  promptText?: string;
}

export type TerminalStreamEvent =
  | { kind: "data"; data: string }
  | { kind: "exit"; exitCode: number | null }
  | { kind: "error"; message: string };

export class MiniUnsupportedError extends Error {
  readonly op: string;
  constructor(op: string) {
    super(`mini 终端不支持 ${op}（需要 full / Rust PTY）`);
    this.name = "MiniUnsupportedError";
    this.op = op;
  }
}

export interface OpenInteractiveOpts {
  agentName: string;
  cwd: string;
  cols?: number;
  rows?: number;
  shell?: string;
}

export interface TerminalBackend {
  readonly kind: TerminalKind;
  initEngine(logDir?: string): void;
  setPersistPath(path: string): void;
  run(
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    timeoutMs?: number,
    resultLimit?: number,
  ): Promise<RunResult>;
  runBackground(
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    id?: string,
  ): Promise<RunResult>;
  write(id: string, agentName: string, data: string): Promise<void>;
  stop(id: string, agentName: string): Promise<void>;
  logs(id: string, agentName: string, lines?: number): Promise<string>;
  list(agentName?: string): TerminalInfo[];
  remove(id: string, agentName: string): Promise<void>;
  cleanupAgent(agentName: string): void;
  shutdown(): void;
  setFilter(config: FilterConfig): void;
  setSandbox(config: SandboxConfig): void;
  statusPanel(agentName: string): string;
  resize?(id: string, cols: number, rows: number): Promise<void>;
  subscribe?(id: string, onEvent: (ev: TerminalStreamEvent) => void): () => void;
  openInteractive?(opts: OpenInteractiveOpts): Promise<{ id: string }>;
}

export interface TerminalResolution {
  backend: TerminalBackend;
  kind: TerminalKind;
  /** 配置要 full，但 Rust .node 不可用，已落到 mini */
  degraded: boolean;
  requested: TerminalKind;
}
