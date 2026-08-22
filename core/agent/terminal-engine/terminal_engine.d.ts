/* auto-generated type declarations for terminal-engine */

export interface CreateTerminalOptions {
  agentName: string
  id?: string
  cwd: string
  cols?: number
  rows?: number
  description: string
}

export interface RunResult {
  ok: boolean
  exitCode: number | null
  output: string
  durationMs: number
  terminalId: string
  error: string | null
}

export interface TerminalEvent {
  terminalId: string
  eventType: string
  data: string | null
  exitCode: number | null
  error: string | null
  timestamp: number
}

export interface FilterConfigNapi {
  presetBlacklistEnabled: boolean
  blacklist: string[]
  whitelist: string[]
  whitelistMode: boolean
}

export interface SandboxConfigNapi {
  enabled: boolean
  allowedPaths: string[]
  deniedPaths: string[]
  injectPrompt: boolean
  promptText?: string
}

export interface TerminalInfoNapi {
  id: string
  agentName: string
  command: string
  description: string
  state: string
  exitCode: number | null
  cwd: string
  createdAt: string
  updatedAt: string
  lastViewedAt?: string
}

export function initEngine(logDir?: string): void
export function setPersistPath(path: string): void
export function run(
  agentName: string,
  command: string,
  cwd: string,
  description: string,
  timeoutMs?: number,
  resultLimit?: number,
): Promise<RunResult>
export function runBackground(
  agentName: string,
  command: string,
  cwd: string,
  description: string,
  id?: string,
): Promise<RunResult>
export function write(id: string, agentName: string, data: string): Promise<void>
export function stop(id: string, agentName: string): Promise<void>
export function logs(id: string, agentName: string, lines?: number): Promise<string>
export function list(agentName?: string): TerminalInfoNapi[]
export function remove(id: string, agentName: string): Promise<void>
export function cleanupAgent(agentName: string): void
export function shutdown(): void
export function setFilter(config: FilterConfigNapi): void
export function loadFilterFromFile(path: string): void
export function setSandbox(config: SandboxConfigNapi): void
export function getSandboxPrompt(): string | null
export function statusPanel(agentName: string): string
export function terminalCount(): number
