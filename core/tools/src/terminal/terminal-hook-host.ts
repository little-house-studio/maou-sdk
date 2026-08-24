/**
 * 终端行为钩子宿主桥 —— tools 不依赖 agent 包，由 Runtime 在构造时 bind。
 *
 * 闸门（可拦、可改写）：terminal_pre_run / terminal_pre_write / terminal_pre_stop / terminal_pre_rm。
 * 观察：started / promoted / exit / until_hit / write / stop / rm。
 * 不接 list / logs / 逐行输出。
 */

export type TerminalGateName =
  | "terminal_pre_run"
  | "terminal_pre_write"
  | "terminal_pre_stop"
  | "terminal_pre_rm";

export type TerminalEmitName =
  | "terminal_started"
  | "terminal_promoted"
  | "terminal_exit"
  | "terminal_until_hit"
  | "terminal_write"
  | "terminal_stop"
  | "terminal_rm";

export interface TerminalGateResult {
  allowed: boolean;
  reason?: string;
  command?: string;
  data?: string;
}

export type TerminalGateFn = (
  name: TerminalGateName,
  payload: Record<string, unknown>,
) => Promise<TerminalGateResult | void> | TerminalGateResult | void;

export type TerminalEmitFn = (
  name: TerminalEmitName,
  payload: Record<string, unknown>,
) => void;

export interface TerminalHookHost {
  gate?: TerminalGateFn;
  emit?: TerminalEmitFn;
}

let host: TerminalHookHost | null = null;

export function bindTerminalHookHost(next: TerminalHookHost | null): void {
  host = next;
}

export async function gateTerminal(
  name: TerminalGateName,
  payload: Record<string, unknown>,
): Promise<TerminalGateResult> {
  const fn = host?.gate;
  if (!fn) return { allowed: true };
  try {
    const r = await fn(name, payload);
    if (!r) return { allowed: true };
    const out: TerminalGateResult = { allowed: r.allowed !== false };
    if (r.reason) out.reason = r.reason;
    if (r.command !== undefined) out.command = r.command;
    if (r.data !== undefined) out.data = r.data;
    return out;
  } catch (err) {
    console.warn("[terminal-hooks]", name, err);
    return { allowed: true };
  }
}

export function emitTerminal(
  name: TerminalEmitName,
  payload: Record<string, unknown>,
): void {
  try {
    host?.emit?.(name, payload);
  } catch (err) {
    console.warn("[terminal-hooks]", name, err);
  }
}
