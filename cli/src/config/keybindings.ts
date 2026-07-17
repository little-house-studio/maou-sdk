/**
 * CLI 热键结构体 —— 与指令注册表 / UI 动作解耦。
 *
 * - 指令类：hotkeyKey 写在 CliCommandSpec 上，本表自动收录
 * - 纯 UI：本表静态声明（命令面板、全屏编辑、音效、审核循环…）
 */

import {
  cliCommands,
  registerBuiltinCliCommands,
} from "../slash/index.js";

export type UiKeyAction =
  | "command_palette"
  | "full_editor"
  | "toggle_sound"
  | "cycle_approval"
  | "open_agents";

export interface KeyBindingDef {
  /** 规范化键：ctrl+m / ctrl+, / shift+tab */
  key: string;
  /** 帮助文案（无 command 时用） */
  label?: string;
  /** 绑定到 CliCommandSpec.id */
  commandId?: string;
  /** 非指令 UI 动作 */
  ui?: UiKeyAction;
}

/** 纯 UI 热键（不在 slash 注册表里） */
export const UI_KEYBINDINGS: readonly KeyBindingDef[] = [
  {
    key: "ctrl+k",
    label: "命令面板",
    ui: "command_palette",
  },
  {
    key: "ctrl+e",
    label: "全屏编辑器",
    ui: "full_editor",
  },
  {
    key: "ctrl+s",
    label: "音效开关",
    ui: "toggle_sound",
  },
  {
    key: "shift+tab",
    label: "循环审核模式",
    ui: "cycle_approval",
  },
  {
    key: "open_agents",
    label: "Agent 面板",
    ui: "open_agents",
  },
] as const;

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "");
}

/** 合并指令 hotkeyKey + UI 热键（指令优先） */
export function listKeyBindings(): KeyBindingDef[] {
  registerBuiltinCliCommands();
  const map = new Map<string, KeyBindingDef>();

  for (const u of UI_KEYBINDINGS) {
    map.set(normalizeKey(u.key), { ...u, key: normalizeKey(u.key) });
  }

  for (const c of cliCommands.list()) {
    const hk = (c as { hotkeyKey?: string }).hotkeyKey;
    if (!hk) continue;
    const key = normalizeKey(hk);
    map.set(key, {
      key,
      label: c.label,
      commandId: c.id,
    });
  }

  return [...map.values()];
}

export function resolveKeyBinding(key: string): KeyBindingDef | undefined {
  const k = normalizeKey(key);
  return listKeyBindings().find((b) => b.key === k);
}
