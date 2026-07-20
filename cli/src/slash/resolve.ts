/**
 * 斜杠指令解析结果 —— 供 cli-session 执行，不进 LLM 的路径。
 */

import { cliCommands, splitSlashTokens } from "./registry.js";
import { registerBuiltinCliCommands } from "./builtins.js";
import type { CliCommandSpec, ResolvedCliCommand } from "./types.js";

export type SlashDispatch =
  | { type: "not_slash" }
  | { type: "unknown"; id: string; hint: string }
  | {
      type: "local";
      resolved: ResolvedCliCommand;
      /** 归一后的动作 */
      action: LocalDispatchAction;
    }
  | {
      type: "runtime";
      resolved: ResolvedCliCommand;
    };

export type LocalDispatchAction =
  | { kind: "new_session"; clear: boolean }
  | { kind: "overlay"; overlay: string }
  | { kind: "thinking_cycle" }
  | { kind: "screenshot" }
  | { kind: "quit" }
  | { kind: "stop" }
  | { kind: "switch_model"; provider: string; model: string }
  | { kind: "open_model" }
  | { kind: "store_command"; id: string }
  | { kind: "usage_hint"; hint: string }
  | { kind: "analyze_session" };

function ensureRegistry(): void {
  registerBuiltinCliCommands();
}

/**
 * 从 model/select 参数解析 provider+model。
 * tokens 已去掉指令名。
 */
export function parseModelSwitchTokens(
  tokens: string[],
):
  | { ok: true; provider: string; model: string }
  | { ok: false; open: true }
  | { ok: false; open: false; hint: string } {
  if (tokens.length === 0) return { ok: false, open: true };

  if (tokens.length === 1) {
    const one = tokens[0]!;
    if (one.includes("/")) {
      const i = one.indexOf("/");
      const p = one.slice(0, i).trim();
      const m = one.slice(i + 1).trim();
      if (p && m) return { ok: true, provider: p, model: m };
    }
    return {
      ok: false,
      open: false,
      hint: "用法: /model <provider> <model>  或  /model 打开列表",
    };
  }

  const provider = tokens[0]!;
  const model = tokens.slice(1).join(" ").trim();
  if (provider && model) return { ok: true, provider, model };
  return {
    ok: false,
    open: false,
    hint: "用法: /model <provider> <model>  或  /model 打开列表",
  };
}

function localActionFromSpec(
  resolved: ResolvedCliCommand,
): LocalDispatchAction {
  const { spec, tokens } = resolved;
  const local = spec.local;

  if (!local) {
    // both 但无 local 元数据：走 store id
    return { kind: "store_command", id: spec.id };
  }

  if (local.kind === "overlay") {
    return { kind: "overlay", overlay: local.overlay };
  }

  switch (local.action) {
    case "new_session":
      return { kind: "new_session", clear: false };
    case "clear_session":
      return { kind: "new_session", clear: true };
    case "thinking_cycle":
      return { kind: "thinking_cycle" };
    case "screenshot":
      return { kind: "screenshot" };
    case "quit":
      return { kind: "quit" };
    case "stop":
      return { kind: "stop" };
    case "analyze_session":
      return { kind: "analyze_session" };
    case "switch_model": {
      const r = parseModelSwitchTokens(tokens);
      if (r.ok) return { kind: "switch_model", provider: r.provider, model: r.model };
      if (r.open) return { kind: "open_model" };
      return { kind: "usage_hint", hint: r.hint };
    }
    default:
      return { kind: "store_command", id: spec.id };
  }
}

/**
 * 统一入口：识别 / 指令 → local 执行 | runtime 透传 | unknown。
 */
export function dispatchSlash(input: string): SlashDispatch {
  ensureRegistry();
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { type: "not_slash" };

  const tokens = splitSlashTokens(trimmed.slice(1));
  if (tokens.length === 0) {
    return {
      type: "unknown",
      id: "",
      hint: "空指令",
    };
  }

  const id = tokens[0]!.toLowerCase().replace(/^\//, "");
  const resolved = cliCommands.resolve(trimmed);

  if (!resolved) {
    return {
      type: "unknown",
      id,
      hint: `未知指令 /${id}（系统指令不进对话；/model 选模型 · /help 帮助）`,
    };
  }

  const { spec } = resolved;

  // stop 虽标 runtime，但 CLI 本地也可中断
  if (spec.local?.kind === "action" && spec.local.action === "stop") {
    return {
      type: "local",
      resolved,
      action: { kind: "stop" },
    };
  }

  if (spec.scope === "local" || (spec.scope === "both" && spec.local)) {
    return {
      type: "local",
      resolved,
      action: localActionFromSpec(resolved),
    };
  }

  // both 无 local、runtime、skill → 透传 agent
  if (
    spec.scope === "runtime" ||
    spec.scope === "skill" ||
    spec.scope === "both"
  ) {
    return { type: "runtime", resolved };
  }

  return {
    type: "unknown",
    id: spec.name,
    hint: `指令 /${spec.name} 无法在本地执行`,
  };
}

export function getSpec(idOrName: string): CliCommandSpec | undefined {
  ensureRegistry();
  return cliCommands.get(idOrName);
}
