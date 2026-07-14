/**
 * Subagent 物化 / 列举 / kill —— 目录模板 + 状态过滤。
 *
 * 路径约定：
 *   nested  durable : <maouRoot>/agents/<parent>/subagents/<name>/
 *   nested  ephemeral: <maouRoot>/agents/<parent>/subagents/.tmp/<name>/
 *   peer            : <maouRoot>/agents/<name>/
 *   shared          : <maouRoot>/agents/.shared/<name>/
 *
 * kill：写 status=killed（或 .killed 标记），管理列表永远过滤 killed。
 * 临时目录：机器重启可回档；kill 后可 rm 快删。
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DefinedSubagent } from "./define-subagent.js";
import type { SubagentKind, SubagentLifecycleStatus, SubagentStorageScope } from "./subagent-kinds.js";

// ─── 路径 ──────────────────────────────────────────────────────────────────

export function resolveSubagentDir(opts: {
  maouRoot: string;
  parentAgentName?: string;
  name: string;
  storageScope: SubagentStorageScope;
  ephemeral: boolean;
}): string {
  const { maouRoot, parentAgentName, name, storageScope, ephemeral } = opts;
  if (storageScope === "peer") {
    return join(maouRoot, "agents", name);
  }
  if (storageScope === "shared") {
    return join(maouRoot, "agents", ".shared", name);
  }
  // nested
  const parent = parentAgentName || "coding";
  const base = join(maouRoot, "agents", parent, "subagents");
  if (ephemeral) {
    return join(base, ".tmp", name);
  }
  return join(base, name);
}

function kindTemplateDir(kind: SubagentKind): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/agent → ../../templates/subagents/kinds/<kind>
  return join(here, "..", "..", "templates", "subagents", "kinds", kind);
}

// ─── 物化 ──────────────────────────────────────────────────────────────────

export interface MaterializeResult {
  ok: boolean;
  dir: string;
  created: boolean;
  message: string;
}

/**
 * 把 DefinedSubagent 落到磁盘（目录模板 + agent.json + 提示词）。
 */
export function materializeSubagent(
  defined: DefinedSubagent,
  opts: { maouRoot: string; force?: boolean },
): MaterializeResult {
  const r = defined.resolved;
  const dir = resolveSubagentDir({
    maouRoot: opts.maouRoot,
    parentAgentName: defined.parentAgentName,
    name: defined.name,
    storageScope: r.storageScope,
    ephemeral: r.ephemeral,
  });

  if (existsSync(join(dir, "agent.json")) && !opts.force) {
    return { ok: true, dir, created: false, message: `已存在: ${dir}` };
  }

  mkdirSync(dir, { recursive: true });

  // 拷贝 kind 最小模板（若有）
  const tpl = kindTemplateDir(defined.kind);
  if (existsSync(tpl)) {
    try {
      cpSync(tpl, dir, { recursive: true });
    } catch {
      /* ignore partial */
    }
  }

  // agent.json
  const agentJson = defined.toAgentJson();
  writeFileSync(join(dir, "agent.json"), JSON.stringify(agentJson, null, 2), "utf-8");

  // 提示词：eve 结构 prompt/system/system.md 或 ROLE/SYSTEM.md
  const prompt =
    r.systemPrompt?.trim() ||
    defaultSystemPrompt(defined.kind, defined.name, r.path);
  const eveSystem = join(dir, "prompt", "system");
  const roleDir = join(dir, "ROLE");
  mkdirSync(eveSystem, { recursive: true });
  mkdirSync(roleDir, { recursive: true });
  writeFileSync(join(eveSystem, "system.md"), prompt, "utf-8");
  writeFileSync(join(roleDir, "SYSTEM.md"), prompt, "utf-8");

  // hook 占位
  mkdirSync(join(dir, "hook"), { recursive: true });
  writeFileSync(
    join(dir, "hook", "README.md"),
    `# hooks for ${defined.name}\n\n可选脚本：on_start / on_end / on_error\n`,
    "utf-8",
  );

  return { ok: true, dir, created: true, message: `已物化 ${defined.kind} → ${dir}` };
}

function defaultSystemPrompt(kind: SubagentKind, name: string, path?: string): string {
  switch (kind) {
    case "fork":
      return `# Fork Agent: ${name}\n\n你是从母 agent 完整 fork 的子分支，拥有独立上下文，可多轮工具循环完成分支任务。完成后用 todo_finish 或清晰结论汇报。\n`;
    case "helper":
      return `# Helper: ${name}\n\n你是辅助 agent：单轮、快速、无工具。根据用户/系统给出的材料直接输出结果，不要调用工具，不要展开多轮计划。\n`;
    case "task":
      return `# Task Agent: ${name}\n\n你是专业子任务 agent，在授权工具白名单内完成单一专业工作，可多轮。\n`;
    case "project":
      return `# Project Agent: ${name}\n\n你是驻扎在 \`${path ?? "."}\` 的小型 coding agent。优先只改该路径内文件；路径外操作需更高权限或等待审核。\n`;
    default:
      return `# Subagent: ${name}\n`;
  }
}

// ─── 列举 / kill ───────────────────────────────────────────────────────────

export interface SubagentListEntry {
  name: string;
  kind: SubagentKind | string;
  dir: string;
  status: SubagentLifecycleStatus;
  parentAgent?: string;
  ephemeral: boolean;
  listInManager: boolean;
  path?: string;
}

function readAgentJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, "agent.json"), "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isKilled(dir: string, json: Record<string, unknown> | null): boolean {
  if (existsSync(join(dir, ".killed"))) return true;
  if (json && (json.status === "killed" || json.lifecycle === "killed")) return true;
  return false;
}

function scanSubagentDir(
  dir: string,
  parentAgent?: string,
): SubagentListEntry | null {
  const json = readAgentJson(dir);
  if (!json && !existsSync(dir)) return null;
  if (isKilled(dir, json)) {
    // kill 的永不进管理列表
    return null;
  }
  const name = String(json?.name ?? dir.split(/[/\\]/).pop() ?? "unknown");
  const listInManager = json?.list_in_manager !== false;
  if (!listInManager) return null;
  // helper 未持久化：list_in_manager 应为 false
  if (json?.subagent_kind === "helper" && json?.persist_context === false) {
    return null;
  }
  return {
    name,
    kind: String(json?.subagent_kind ?? json?.role ?? "task"),
    dir,
    status: (json?.status as SubagentLifecycleStatus) || "active",
    parentAgent,
    ephemeral: Boolean(json?.ephemeral),
    listInManager: true,
    path: typeof json?.path === "string" ? json.path : undefined,
  };
}

/**
 * 列出母 agent 下可见的 subagent（排除 killed、非 list、未持久化 helper）。
 */
export function listManagedSubagents(
  maouRoot: string,
  parentAgentName: string,
): SubagentListEntry[] {
  const out: SubagentListEntry[] = [];
  const nested = join(maouRoot, "agents", parentAgentName, "subagents");
  const scanNested = (base: string) => {
    if (!existsSync(base)) return;
    for (const ent of readdirSync(base)) {
      if (ent.startsWith(".") && ent !== ".tmp") continue;
      const p = join(base, ent);
      try {
        if (!statSync(p).isDirectory()) continue;
      } catch {
        continue;
      }
      if (ent === ".tmp") {
        // 临时也可列（未 kill 且 list_in_manager）
        for (const t of readdirSync(p)) {
          const tp = join(p, t);
          try {
            if (!statSync(tp).isDirectory()) continue;
          } catch {
            continue;
          }
          const e = scanSubagentDir(tp, parentAgentName);
          if (e) out.push(e);
        }
        continue;
      }
      const e = scanSubagentDir(p, parentAgentName);
      if (e) out.push(e);
    }
  };
  scanNested(nested);

  // peer / shared 中 parent_agent 指向自己的也列出
  const agentsRoot = join(maouRoot, "agents");
  if (existsSync(agentsRoot)) {
    for (const ent of readdirSync(agentsRoot)) {
      if (ent.startsWith(".")) continue;
      const p = join(agentsRoot, ent);
      try {
        if (!statSync(p).isDirectory()) continue;
      } catch {
        continue;
      }
      const json = readAgentJson(p);
      if (!json || json.scope !== "subagent") continue;
      if (json.parent_agent && json.parent_agent !== parentAgentName) continue;
      const e = scanSubagentDir(p, parentAgentName);
      if (e) out.push(e);
    }
    const shared = join(agentsRoot, ".shared");
    if (existsSync(shared)) {
      for (const ent of readdirSync(shared)) {
        const e = scanSubagentDir(join(shared, ent), parentAgentName);
        if (e) out.push(e);
      }
    }
  }

  return out;
}

/**
 * Kill：标记 killed，不出现在管理列表。
 * @param hardDelete 为 true 时直接 rm 目录（临时 agent 推荐）
 */
export function killSubagent(
  dir: string,
  opts: { hardDelete?: boolean } = {},
): { ok: boolean; message: string } {
  if (!existsSync(dir)) {
    return { ok: false, message: `不存在: ${dir}` };
  }
  if (opts.hardDelete) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return { ok: true, message: `已删除: ${dir}` };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }
  try {
    const json = readAgentJson(dir) ?? {};
    json.status = "killed";
    json.killed_at = new Date().toISOString();
    writeFileSync(join(dir, "agent.json"), JSON.stringify(json, null, 2), "utf-8");
    writeFileSync(join(dir, ".killed"), new Date().toISOString(), "utf-8");
    return { ok: true, message: `已标记 killed: ${dir}` };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

/** 清理母 agent 下所有 .tmp 中已 killed 的目录 */
export function purgeKilledEphemeral(
  maouRoot: string,
  parentAgentName: string,
): number {
  const tmp = join(maouRoot, "agents", parentAgentName, "subagents", ".tmp");
  if (!existsSync(tmp)) return 0;
  let n = 0;
  for (const ent of readdirSync(tmp)) {
    const p = join(tmp, ent);
    if (isKilled(p, readAgentJson(p))) {
      try {
        rmSync(p, { recursive: true, force: true });
        n++;
      } catch {
        /* ignore */
      }
    }
  }
  return n;
}
