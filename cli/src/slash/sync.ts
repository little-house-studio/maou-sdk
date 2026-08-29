/**
 * 动态注册：SDK commandRegistry + skills → CliCommandRegistry
 */

import { readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { listSkillScanRoots } from "@little-house-studio/tools";
import { cliCommands } from "./registry.js";
import { registerBuiltinCliCommands } from "./builtins.js";
import type { CliCommandSpec } from "./types.js";
import { userMaouRoot } from "../config/paths.js";
import { DEFAULT_AGENT_NAME } from "../config/defaults.js";

export interface RuntimeCommandListItem {
  name: string;
  description?: string;
  usage?: string;
}

/** 从 agent.commandRegistry.list() 同步（覆盖同名 runtime 源） */
export function syncRuntimeCommands(
  list: RuntimeCommandListItem[] | null | undefined,
): number {
  registerBuiltinCliCommands();
  cliCommands.unregisterBySource("runtime");
  if (!list?.length) return 0;
  let n = 0;
  for (const c of list) {
    const name = (c.name ?? "").replace(/^\//, "").trim();
    if (!name) continue;
    // 不覆盖 builtin local 指令（model/settings…）
    const existing = cliCommands.get(name);
    if (existing && existing.source === "builtin" && existing.scope === "local") {
      continue;
    }
    // builtin both/runtime 可被 runtime 描述覆盖 description
    if (existing?.source === "builtin" && existing.scope !== "local") {
      cliCommands.register({
        ...existing,
        description: c.description || existing.description,
        usage: c.usage ?? existing.usage,
        source: "builtin", // 保持 builtin，避免被下次 sync 卸掉
      });
      continue;
    }
    const spec: CliCommandSpec = {
      id: `runtime:${name}`,
      name,
      label: `/${name}`,
      description: c.description || `runtime · /${name}`,
      usage: c.usage,
      scope: "runtime",
      category: "agent",
      source: "runtime",
      palette: false,
    };
    cliCommands.register(spec);
    n++;
  }
  return n;
}

export type SkillScanContext = {
  agentName?: string;
  projectRoot?: string;
  maouRoot?: string;
  home?: string;
};

let skillScanCtx: SkillScanContext = {};

export function setSkillScanContext(ctx: SkillScanContext): void {
  skillScanCtx = { ...skillScanCtx, ...ctx };
}

function scanSkillNames(): string[] {
  const roots = listSkillScanRoots({
    projectRoot: skillScanCtx.projectRoot ?? process.cwd(),
    maouRoot: skillScanCtx.maouRoot ?? userMaouRoot(),
    agentName: skillScanCtx.agentName ?? DEFAULT_AGENT_NAME,
    home: skillScanCtx.home,
  });
  const byName = new Map<string, string>();
  for (const { dir } of roots) {
    if (!existsSync(dir)) continue;
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        let name = "";
        if (ent.isDirectory()) {
          const skillMd = join(dir, ent.name, "SKILL.md");
          if (
            existsSync(skillMd) ||
            existsSync(join(dir, ent.name, "skill.md"))
          ) {
            name = ent.name;
          }
        } else if (ent.name.endsWith(".md")) {
          name = basename(ent.name, ".md");
        }
        if (!name) continue;
        byName.set(name, name);
      }
    } catch {
      /* ignore */
    }
  }
  return [...byName.values()];
}

/** 扫描 skills 目录并注册为 skill scope */
export function syncSkillCommands(opts?: SkillScanContext): number {
  if (opts) setSkillScanContext(opts);
  registerBuiltinCliCommands();
  cliCommands.unregisterBySource("skill");
  let n = 0;
  for (const name of scanSkillNames()) {
    if (cliCommands.has(name)) continue; // 不覆盖 builtin/runtime
    cliCommands.register({
      id: `skill:${name}`,
      name,
      label: `/${name}`,
      description: `skill · ${name}`,
      scope: "skill",
      category: "skill",
      source: "skill",
      palette: false,
    });
    n++;
  }
  return n;
}

/** 一站式刷新动态源 */
export function refreshDynamicCommands(
  runtimeList?: RuntimeCommandListItem[] | null,
): void {
  registerBuiltinCliCommands();
  if (runtimeList !== undefined) syncRuntimeCommands(runtimeList);
  syncSkillCommands();
}
