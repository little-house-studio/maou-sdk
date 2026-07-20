/**
 * 本地斜杠解析 —— 委托统一注册表 `dispatchSlash`。
 *
 * 保留旧 API 形状，供既有测试与调用方使用。
 */

import {
  dispatchSlash,
  parseModelSwitchTokens,
  splitSlashTokens,
  type LocalDispatchAction,
  type SlashDispatch,
} from "../slash/index.js";

export type LocalSlashAction =
  | { type: "new_session"; clear: boolean }
  | { type: "local_id"; id: string }
  | { type: "switch_model"; provider: string; model: string }
  | { type: "open_model" }
  | { type: "unknown"; id: string; hint?: string }
  | { type: "passthrough" }
  | { type: "overlay"; overlay: string }
  | { type: "thinking_cycle" }
  | { type: "screenshot" }
  | { type: "quit" }
  | { type: "stop" }
  | { type: "usage_hint"; hint: string }
  | { type: "analyze_session" };

export interface ParseLocalSlashOpts {
  /** @deprecated 注册表已含 local 判断；保留参数兼容 */
  isLocalCommand?: (id: string) => boolean;
  /** @deprecated 注册表已含 known；保留参数兼容 */
  isKnownSlash?: (id: string) => boolean;
}

export { splitSlashTokens, parseModelSwitchTokens };

/** @deprecated 用 parseModelSwitchTokens */
export function parseModelArgs(args: string[]): LocalSlashAction {
  const r = parseModelSwitchTokens(args);
  if (r.ok) {
    return { type: "switch_model", provider: r.provider, model: r.model };
  }
  if (r.open) return { type: "open_model" };
  return { type: "unknown", id: "model", hint: r.hint };
}

function fromLocalAction(a: LocalDispatchAction): LocalSlashAction {
  switch (a.kind) {
    case "new_session":
      return { type: "new_session", clear: a.clear };
    case "overlay":
      return { type: "overlay", overlay: a.overlay };
    case "thinking_cycle":
      return { type: "thinking_cycle" };
    case "screenshot":
      return { type: "screenshot" };
    case "quit":
      return { type: "quit" };
    case "stop":
      return { type: "stop" };
    case "switch_model":
      return {
        type: "switch_model",
        provider: a.provider,
        model: a.model,
      };
    case "open_model":
      return { type: "open_model" };
    case "store_command":
      return { type: "local_id", id: a.id };
    case "usage_hint":
      return { type: "usage_hint", hint: a.hint };
    case "analyze_session":
      return { type: "analyze_session" };
    default:
      return { type: "passthrough" };
  }
}

/**
 * 若 text 以 / 开头则解析为本地/系统动作；否则 passthrough。
 * 基于 `CliCommandSpec` 注册表，不再硬编码指令名单。
 */
export function parseLocalSlash(
  text: string,
  _opts?: ParseLocalSlashOpts,
): LocalSlashAction {
  const d: SlashDispatch = dispatchSlash(text);
  switch (d.type) {
    case "not_slash":
      return { type: "passthrough" };
    case "unknown":
      return { type: "unknown", id: d.id, hint: d.hint };
    case "runtime":
      return { type: "passthrough" };
    case "local":
      return fromLocalAction(d.action);
    default:
      return { type: "passthrough" };
  }
}
