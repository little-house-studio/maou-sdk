export interface TerminalInfoNapi {
  id: string;
  state: "running" | "exited" | "interrupted" | "killed" | "unknown";
  exitCode: number | null;
  command: string;
  description: string;
  agentName: string;
}

export interface FilterConfigNapi {
  preset_blacklist_enabled?: boolean;
  presetBlacklistEnabled?: boolean;
  blacklist?: string[];
  whitelist?: string[];
  whitelist_mode?: boolean;
  whitelistMode?: boolean;
}

export interface SandboxConfigNapi {
  allowed_paths?: string[];
  deny_paths?: string[];
}

export interface RunResultNapi {
  terminalId: string;
  output: string;
  exitCode: number | null;
  ok: boolean;
  durationMs: number;
}

export interface WriteResultNapi {
  written: boolean;
}

export function initEngine(logDir?: string): void;
export function setPersistPath(path: string): void;
export function setFilter(config: FilterConfigNapi): void;
export function setSandbox(config: SandboxConfigNapi): void;
export function shutdown(): void;
export function cleanupAgent(agentName: string): void;
export function statusPanel(agentName: string): string;
export function list(agentName?: string): TerminalInfoNapi[];
export function logs(id: string, agentName: string, lines: number): Promise<string>;
export function run(
  agentName: string,
  command: string,
  cwd: string,
  description: string,
  timeoutMs: number,
  resultLimit: number
): Promise<RunResultNapi>;
export function runBackground(
  agentName: string,
  command: string,
  cwd: string,
  description: string,
  id?: string
): Promise<RunResultNapi>;
export function remove(id: string, agentName: string): Promise<void>;
export function stop(id: string, agentName: string): Promise<void>;
export function write(id: string, agentName: string, input: string): Promise<WriteResultNapi>;