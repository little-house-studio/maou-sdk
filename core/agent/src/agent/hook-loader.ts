/**
 * 从 agent 的 hook/ 目录加载脚本并注册到 Hooks。
 *
 * 文件名 = 钩子名（或别名）：pre_tool_use.ts、on_user_message.ts、loop_end.mjs。
 * 导出 default / handler / 与文件名同名的函数。
 * 实例目录优先于模板目录之后注册（后注册的 handler 后执行）。
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Hooks } from "./hooks.js";
import { isKnownHookName, resolveHookName } from "./hook-names.js";

const HOOK_SCRIPT_EXT = [".ts", ".mjs", ".js"] as const;

export function listHookScriptFiles(hookDir: string): string[] {
  if (!existsSync(hookDir)) return [];
  let files: string[] = [];
  try {
    files = readdirSync(hookDir);
  } catch {
    return [];
  }
  return files
    .filter((file) => {
      if (file.startsWith(".")) return false;
      return HOOK_SCRIPT_EXT.some((ext) => file.endsWith(ext));
    })
    .sort();
}

export function hookNameFromFilename(file: string): string | null {
  const ext = HOOK_SCRIPT_EXT.find((e) => file.endsWith(e));
  if (!ext) return null;
  const stem = file.slice(0, -ext.length);
  if (!isKnownHookName(stem)) return null;
  return resolveHookName(stem);
}

export async function loadHookScripts(
  hooks: Hooks,
  hookDirs: string[],
): Promise<{ loaded: string[] }> {
  const loaded: string[] = [];
  for (const dir of hookDirs) {
    for (const file of listHookScriptFiles(dir)) {
      const hookName = hookNameFromFilename(file);
      if (!hookName) continue;
      const abs = join(dir, file);
      try {
        const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
        const stem = file.replace(/\.(ts|mjs|js)$/, "");
        const fn =
          mod.default ??
          mod.handler ??
          mod[stem] ??
          mod[hookName];
        if (typeof fn !== "function") continue;
        hooks.register(hookName, fn as Parameters<Hooks["register"]>[1]);
        loaded.push(`${abs}→${hookName}`);
      } catch (e) {
        console.error(`[sdk] 加载 hook 脚本失败 ${abs}:`, e);
      }
    }
  }
  return { loaded };
}
