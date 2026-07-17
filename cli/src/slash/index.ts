/**
 * CLI 斜杠指令子系统
 *
 * 结构体：`CliCommandSpec`（每条指令完整配置）
 * 注册表：`cliCommands` / `CliCommandRegistry`（动态 register）
 * 解析：  `dispatchSlash`（local / runtime / unknown）
 * 同步：  `syncRuntimeCommands` · `syncSkillCommands`
 */

export type {
  CliCommandSpec,
  CliCommandArgSpec,
  CliLocalAction,
  CommandScope,
  CommandCategory,
  CommandSource,
  ResolvedCliCommand,
  SlashItem,
  PaletteItem,
} from "./types.js";

export {
  CliCommandRegistry,
  cliCommands,
  splitSlashTokens,
} from "./registry.js";

export {
  BUILTIN_CLI_COMMANDS,
  registerBuiltinCliCommands,
  resetBuiltinCliCommandsForTest,
} from "./builtins.js";

export {
  dispatchSlash,
  parseModelSwitchTokens,
  getSpec,
  type SlashDispatch,
  type LocalDispatchAction,
} from "./resolve.js";

export {
  syncRuntimeCommands,
  syncSkillCommands,
  refreshDynamicCommands,
  type RuntimeCommandListItem,
} from "./sync.js";

import { registerBuiltinCliCommands } from "./builtins.js";
import { cliCommands } from "./registry.js";
import type { PaletteItem, SlashItem } from "./types.js";

// 模块加载时注册内置，保证 isLocalCommand 等立即可用
registerBuiltinCliCommands();

/** @deprecated 用 CliCommandSpec；兼容旧名 */
export type CliCommandDef = import("./types.js").CliCommandSpec;

/** 兼容旧 API：静态列表快照 */
export function listCliCommands() {
  registerBuiltinCliCommands();
  return cliCommands.list();
}

export function getCommand(id: string) {
  registerBuiltinCliCommands();
  return cliCommands.get(id);
}

export function isLocalCommandId(id: string): boolean {
  registerBuiltinCliCommands();
  return cliCommands.isLocal(id);
}

/** 该指令是否打开 overlay（命令面板选中后应保持/切换到目标面板，勿立刻关掉） */
export function commandOpensOverlay(id: string): boolean {
  registerBuiltinCliCommands();
  const s = cliCommands.get(id);
  return s?.local?.kind === "overlay" || s?.local?.action === "switch_model";
}

export function localCommandIdSet(): Set<string> {
  registerBuiltinCliCommands();
  return new Set(
    cliCommands
      .list()
      .filter((c) => c.scope === "local" || c.scope === "both")
      .map((c) => c.id),
  );
}

export function uiSlashCommands(): SlashItem[] {
  registerBuiltinCliCommands();
  return cliCommands.slashItems({ scopes: ["local", "both"] });
}

export function runtimeSlashFallbacks(): SlashItem[] {
  registerBuiltinCliCommands();
  return cliCommands.slashItems({ scopes: ["runtime"] });
}

export function commandPaletteItems(): PaletteItem[] {
  registerBuiltinCliCommands();
  return cliCommands.paletteItems();
}

export function helpKeyRows(): [string, string][] {
  registerBuiltinCliCommands();
  const fixed: [string, string][] = [
    ["Enter", "发送"],
    ["Alt+Enter", "换行"],
    ["Tab / Shift+Tab", "补全确认 / 切换审核模式"],
    ["Ctrl+K", "命令面板"],
    ["Ctrl+E", "全屏编辑器"],
    ["Ctrl+S", "音效开关"],
    ["Esc", "取消/返回/关闭"],
    ["Ctrl+C", "同 Esc；无可取消时连按退出"],
  ];
  const fromReg: [string, string][] = cliCommands
    .list()
    .filter((c) => c.hotkey)
    .map((c) => [c.hotkey!, c.description || c.label] as [string, string]);

  // 从注册表自动生成斜杠摘要（local + 常用 runtime）
  const slashHint: [string, string][] = cliCommands
    .list()
    .filter(
      (c) =>
        !c.hidden &&
        (c.scope === "local" ||
          c.scope === "both" ||
          ["compact", "usage", "context", "goal"].includes(c.name)),
    )
    .slice(0, 12)
    .map((c) => {
      const names = [c.name, ...(c.aliases ?? [])].map((n) => `/${n}`).join(" ");
      return [names, c.description] as [string, string];
    });

  const seen = new Set(fixed.map(([k]) => k));
  const extra = fromReg.filter(([k]) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return [...fixed, ...extra, ...slashHint];
}

/** 兼容：旧 CLI_COMMANDS 数组 */
export const CLI_COMMANDS = new Proxy([] as import("./types.js").CliCommandSpec[], {
  get(_t, prop) {
    registerBuiltinCliCommands();
    const list = cliCommands.list({ source: "builtin" });
    if (prop === "length") return list.length;
    if (prop === Symbol.iterator) return list[Symbol.iterator].bind(list);
    if (typeof prop === "string" && /^\d+$/.test(prop)) {
      return list[Number(prop)];
    }
    const v = Reflect.get(list, prop, list);
    return typeof v === "function" ? v.bind(list) : v;
  },
});
