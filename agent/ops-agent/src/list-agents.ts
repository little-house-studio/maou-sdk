/**
 * Ops Agent 列表：系统级（全局）+ 本机已注册项目级 coding agent。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  getProjectsList,
  resolveUserMaouRoot,
  resolveUserOpsRoot,
} from "@little-house-studio/types";
import { listAgentsForCli, readAgentOverview } from "@little-house-studio/agent";
import type { AgentEntry } from "@little-house-studio/agent";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type OpsAgentListEntry = AgentEntry & {
  /** system = 机器级；project = 某项目下 */
  group?: "system" | "project";
  /** 项目绝对路径（project 组） */
  project_path?: string;
  /** 项目显示名 */
  project_name?: string;
  /** 切换时用的稳定 id：system:ops / project:<path>:coding */
  switch_id?: string;
  /** 上次活动时间（ISO 或 mtime） */
  last_active_at?: string;
  /** 超过 7 天未活动 */
  stale?: boolean;
  /** 是否有子 agent 目录 */
  has_subagents?: boolean;
};

function agentDirMtime(dir: string): string | undefined {
  try {
    return new Date(statSync(dir).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

function loadOverview(agentDir: string, fallback = ""): string {
  try {
    const o = readAgentOverview(agentDir);
    if (o) return o;
  } catch { /* ignore */ }
  // 兼容无 agent 包导出旧 dist
  try {
    const md = join(agentDir, "OVERVIEW.md");
    if (existsSync(md)) {
      const t = readFileSync(md, "utf-8").trim().split("\n").find((l) => l.trim() && !l.startsWith("#"));
      if (t) return t.trim().slice(0, 120);
    }
  } catch { /* ignore */ }
  return fallback;
}

function listProjectAgentNames(projectPath: string): string[] {
  const dir = join(projectPath, ".maou", "agents");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * 构建 Ops 用 agent 列表：
 * 1. 系统主 agent（ops 及全局 agents，排除纯项目物化）
 * 2. 本机 projects.json 中的项目主 agent（coding），按上次活动排序
 */
export function listOpsAgents(maouRoot?: string): OpsAgentListEntry[] {
  const root = maouRoot ?? resolveUserMaouRoot();
  const opsRoot = resolveUserOpsRoot(root);
  const out: OpsAgentListEntry[] = [];
  const now = Date.now();

  // ── 系统级：全局 ~/.maou/agents + ops 工作区 ──
  try {
    const system = listAgentsForCli(root, opsRoot) as OpsAgentListEntry[];
    for (const e of system) {
      const dir = join(root, "agents", e.name);
      const last = agentDirMtime(dir);
      const lastMs = last ? Date.parse(last) : 0;
      const overview = loadOverview(dir, e.description || e.notes || "机器级助手");
      out.push({
        ...e,
        group: "system",
        switch_id: `system:${e.name}`,
        last_active_at: last,
        stale: lastMs > 0 ? now - lastMs > SEVEN_DAYS_MS : false,
        has_subagents: existsSync(join(dir, "subagents")),
        description: overview,
        notes: overview,
      });
    }
  } catch {
    /* ignore */
  }

  // 若列表里没有 ops，补一条
  if (!out.some((e) => e.name === "ops" && e.group === "system")) {
    out.unshift({
      name: "ops",
      display_name: "Ops Agent",
      status: "idle",
      role: "ops",
      team: "",
      parent: "",
      personality: "",
      scope: "global",
      description: "机器级电脑管家",
      notes: "",
      created_by: "system",
      created_at: "",
      updated_at: "",
      group: "system",
      switch_id: "system:ops",
      has_subagents: true,
    });
  }

  // ── 项目级：projects.json ──
  // isActive 要求 .maou/project.json；老项目常只有 .maou/ 目录。路径仍在就列出。
  const projects = getProjectsList(root).filter((p) => existsSync(p.path));
  const projectEntries: OpsAgentListEntry[] = [];
  for (const p of projects) {
    const names = listProjectAgentNames(p.path);
    const mainName = names.includes("coding")
      ? "coding"
      : names.includes("main")
        ? "main"
        : names[0];
    if (!mainName) {
      // 有 project 标记但尚未物化 agent：仍列出，便于切换后物化
      const marker = join(p.path, ".maou", "project.json");
      const last = agentDirMtime(join(p.path, ".maou")) ?? agentDirMtime(marker);
      const lastMs = last ? Date.parse(last) : 0;
      projectEntries.push({
        name: "coding",
        display_name: p.name,
        status: "idle",
        role: "coding",
        team: "",
        parent: "",
        personality: "",
        scope: "project",
        description: p.path,
        notes: "尚未驻扎 coding agent；切换后将自动物化",
        created_by: "registry",
        created_at: p.created_at ?? "",
        updated_at: p.updated_at ?? "",
        group: "project",
        project_path: p.path,
        project_name: p.name,
        switch_id: `project:${p.path}:coding`,
        last_active_at: last ?? p.updated_at,
        stale: lastMs > 0 ? now - lastMs > SEVEN_DAYS_MS : false,
        has_subagents: false,
      });
      continue;
    }

    const agentDir = join(p.path, ".maou", "agents", mainName);
    const last = agentDirMtime(agentDir) ?? p.updated_at;
    const lastMs = last ? Date.parse(last) : 0;
    const subDir = join(p.path, ".maou", "agents");
    const subs = names.filter((n) => n !== mainName);
    const overview = loadOverview(agentDir, p.path);

    projectEntries.push({
      name: mainName,
      display_name: p.name,
      status: "idle",
      role: "coding",
      team: "",
      parent: "",
      personality: "",
      scope: "project",
      description: overview,
      notes: overview,
      created_by: "registry",
      created_at: p.created_at ?? "",
      updated_at: p.updated_at ?? "",
      group: "project",
      project_path: p.path,
      project_name: p.name,
      switch_id: `project:${p.path}:${mainName}`,
      last_active_at: last,
      stale: lastMs > 0 ? now - lastMs > SEVEN_DAYS_MS : false,
      has_subagents: subs.length > 0 || existsSync(join(agentDir, "subagents")),
    });

    // 子 agent：全部登记；UI 按 presence 折叠未运行的
    for (const sub of subs) {
      const sdir = join(subDir, sub);
      const slast = agentDirMtime(sdir);
      const so = loadOverview(sdir, `${p.name} / ${sub}`);
      projectEntries.push({
        name: sub,
        display_name: sub,
        status: "idle",
        role: "subagent",
        team: "",
        parent: mainName,
        personality: "",
        scope: "project",
        description: so,
        notes: so,
        created_by: "registry",
        created_at: "",
        updated_at: "",
        group: "project",
        project_path: p.path,
        project_name: p.name,
        switch_id: `project:${p.path}:${sub}`,
        last_active_at: slast,
        stale: false,
      });
    }
  }

  // 项目主 agent 按 last_active 倒序（子 agent 跟在主后面，排序时主优先）
  const mains = projectEntries.filter((e) => !e.parent);
  const children = projectEntries.filter((e) => !!e.parent);
  mains.sort((a, b) => {
    const ta = Date.parse(a.last_active_at ?? "") || 0;
    const tb = Date.parse(b.last_active_at ?? "") || 0;
    return tb - ta;
  });
  for (const m of mains) {
    out.push(m);
    for (const c of children.filter((x) => x.project_path === m.project_path && x.parent === m.name)) {
      out.push(c);
    }
  }

  return out;
}

/** 解析 switch_id */
export function parseAgentSwitchId(id: string): {
  kind: "system" | "project";
  agentName: string;
  projectPath?: string;
} | null {
  if (id.startsWith("system:")) {
    return { kind: "system", agentName: id.slice("system:".length) };
  }
  if (id.startsWith("project:")) {
    // project:<path>:<agentName>  — path 可能含冒号（Windows），从右侧拆 agentName
    const rest = id.slice("project:".length);
    const lastColon = rest.lastIndexOf(":");
    if (lastColon <= 0) return null;
    const projectPath = rest.slice(0, lastColon);
    const agentName = rest.slice(lastColon + 1);
    if (!projectPath || !agentName) return null;
    return { kind: "project", agentName, projectPath };
  }
  // 兼容裸名字
  if (id && !id.includes("/")) {
    return { kind: "system", agentName: id };
  }
  return null;
}
