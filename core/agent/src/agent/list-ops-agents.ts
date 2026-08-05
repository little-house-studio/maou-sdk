/**
 * Ops / 管理器 agent 列表（CLI + WebUI 共用权威实现）
 *
 * 产品模型：
 *   system  → 仅机器级主体（默认 ops）；coding 永不 system
 *   project → 各项目 coding（及顶层可展示子 agent）
 *
 * 禁止：
 *   - listAgentsForCli(root, opsRoot) 把 ops 工作区 coding 混进 system
 *   - 附属驻扎（proactive 等）升格为可切换主体
 *   - 全局磁盘上的 coding/main 血统当 system 自由人
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  getProjectsList,
  resolveUserMaouRoot,
} from "@little-house-studio/types";
import { AgentRegistry, type AgentEntry } from "./registry.js";
import { readAgentOverview } from "./overview.js";
import {
  isCodingAgentIdentity,
  isStationedAffiliateAgentName,
  isSwitchableSystemAgent,
} from "./agent-identity.js";

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
  } catch {
    /* ignore */
  }
  try {
    const md = join(agentDir, "OVERVIEW.md");
    if (existsSync(md)) {
      const t = readFileSync(md, "utf-8")
        .trim()
        .split("\n")
        .find((l) => l.trim() && !l.startsWith("#"));
      if (t) return t.trim().slice(0, 120);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

function projectDisplayName(path: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const base = path.replace(/\/+$/, "").split("/").pop();
  return base || path;
}

/**
 * 项目级可切换 / 可展示 agent 目录名（排除附属驻扎名）。
 * nested subagents 在 parent/subagents/ 下，不在此列。
 */
function listProjectAgentNames(projectPath: string): string[] {
  const dir = join(projectPath, ".maou", "agents");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .filter((n) => !isStationedAffiliateAgentName(n))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function emptyAgentFields(
  partial: Partial<OpsAgentListEntry> & { name: string },
): OpsAgentListEntry {
  const {
    name,
    display_name,
    status,
    role,
    team,
    parent,
    personality,
    scope,
    description,
    notes,
    created_by,
    created_at,
    updated_at,
    ...rest
  } = partial;
  return {
    name,
    display_name: display_name ?? name,
    status: status ?? "idle",
    role: role ?? "",
    team: team ?? "",
    parent: parent ?? "",
    personality: personality ?? "",
    scope: scope ?? "",
    description: description ?? "",
    notes: notes ?? "",
    created_by: created_by ?? "",
    created_at: created_at ?? "",
    updated_at: updated_at ?? "",
    ...rest,
  };
}

function pushProjectAgents(
  projectEntries: OpsAgentListEntry[],
  p: { name: string; path: string; created_at?: string; updated_at?: string },
  now: number,
): void {
  const names = listProjectAgentNames(p.path);
  const mainName = names.includes("coding")
    ? "coding"
    : names.includes("main")
      ? "main"
      : names[0];

  if (!mainName) {
    const marker = join(p.path, ".maou", "project.json");
    if (!existsSync(marker) && !existsSync(join(p.path, ".maou"))) return;
    const last =
      agentDirMtime(join(p.path, ".maou")) ?? agentDirMtime(marker);
    const lastMs = last ? Date.parse(last) : 0;
    projectEntries.push(
      emptyAgentFields({
        name: "coding",
        display_name: p.name,
        role: "coding",
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
      }),
    );
    return;
  }

  const agentDir = join(p.path, ".maou", "agents", mainName);
  const last = agentDirMtime(agentDir) ?? p.updated_at;
  const lastMs = last ? Date.parse(last) : 0;
  const subDir = join(p.path, ".maou", "agents");
  const subs = names.filter((n) => n !== mainName);
  const overview = loadOverview(agentDir, p.path);

  projectEntries.push(
    emptyAgentFields({
      name: mainName,
      display_name: p.name,
      role: "coding",
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
      has_subagents:
        subs.length > 0 || existsSync(join(agentDir, "subagents")),
    }),
  );

  for (const sub of subs) {
    // 附属驻扎即使误放顶层也不进列表
    if (isStationedAffiliateAgentName(sub)) continue;
    const sdir = join(subDir, sub);
    // 读 agent.json：奴隶 / 第二 coding 不当自由人子项
    let subRole = "";
    let subDisplay = sub;
    try {
      const aj = join(sdir, "agent.json");
      if (existsSync(aj)) {
        const data = JSON.parse(readFileSync(aj, "utf-8")) as {
          list_in_manager?: boolean;
          stationed?: boolean;
          role?: string;
          display_name?: string;
        };
        if (data.list_in_manager === false || data.stationed === true) {
          continue;
        }
        subRole = String(data.role || "");
        subDisplay = String(data.display_name || sub);
      }
    } catch {
      /* keep listing if unreadable */
    }
    // 主已是 coding 时，历史 main/code 双胞胎不再并列成自由子项
    if (
      mainName === "coding" &&
      ["main", "code", "coder"].includes(sub.toLowerCase())
    ) {
      continue;
    }
    if (isCodingAgentIdentity(sub, subRole, subDisplay)) continue;
    const slast = agentDirMtime(sdir);
    const so = loadOverview(sdir, `${p.name} / ${sub}`);
    projectEntries.push(
      emptyAgentFields({
        name: sub,
        display_name: sub,
        role: "subagent",
        parent: mainName,
        scope: "project",
        description: so,
        notes: so,
        created_by: "registry",
        group: "project",
        project_path: p.path,
        project_name: p.name,
        switch_id: `project:${p.path}:${sub}`,
        last_active_at: slast,
        stale: false,
      }),
    );
  }
}

export type ListOpsAgentsOptions = {
  maouRoot?: string;
  /**
   * 额外项目根（即使不在 projects.json）—— WebUI hub cwd / 当前切换项目。
   */
  ensureProjectPaths?: string[];
};

/**
 * 构建 Ops / 管理器 agent 列表：
 * 1. 系统主体：仅全局 ~/.maou/agents，且通过 isSwitchableSystemAgent
 * 2. 项目主体：projects.json（+ ensure）下的 coding 等
 */
export function listOpsAgents(
  maouRootOrOpts?: string | ListOpsAgentsOptions,
  ensureProjectPaths?: string[],
): OpsAgentListEntry[] {
  const opts: ListOpsAgentsOptions =
    typeof maouRootOrOpts === "string" || maouRootOrOpts === undefined
      ? { maouRoot: maouRootOrOpts, ensureProjectPaths }
      : maouRootOrOpts;

  const root = opts.maouRoot ?? resolveUserMaouRoot();
  const out: OpsAgentListEntry[] = [];
  const now = Date.now();

  /**
   * 系统 agent：只扫全局 ~/.maou/agents。
   * 禁止传 opsRoot 当 projectRoot（会把 ops/.maou/agents/coding 混进 system）。
   */
  try {
    const system = new AgentRegistry(root).list();
    for (const e of system) {
      if (!isSwitchableSystemAgent(e)) continue;
      const name = String(e.name || "").trim();
      const dir = join(root, "agents", name);
      if (!existsSync(dir)) continue;
      const last = agentDirMtime(dir);
      const lastMs = last ? Date.parse(last) : 0;
      const overview = loadOverview(
        dir,
        String(e.description || e.notes || "机器级助手"),
      );
      out.push({
        ...e,
        name,
        display_name: String(e.display_name || name),
        group: "system",
        switch_id: `system:${name}`,
        last_active_at: last,
        stale: lastMs > 0 ? now - lastMs > SEVEN_DAYS_MS : false,
        has_subagents: existsSync(join(dir, "subagents")),
        description: overview,
        notes: overview,
        // 清掉误带的 project / parent 语义
        project_path: undefined,
        project_name: undefined,
        parent: "",
        scope: "global",
      });
    }
  } catch {
    /* ignore */
  }

  if (!out.some((e) => e.name === "ops" && e.group === "system")) {
    out.unshift(
      emptyAgentFields({
        name: "ops",
        display_name: "Ops Agent",
        role: "ops",
        scope: "global",
        description: "机器级电脑管家",
        notes: "",
        created_by: "system",
        group: "system",
        switch_id: "system:ops",
        has_subagents: true,
      }),
    );
  }

  // isActive 要求 .maou/project.json；老项目常只有 .maou/ —— 路径存在就列
  const projects = getProjectsList(root).filter((p) => existsSync(p.path));
  const seenPaths = new Set(projects.map((p) => p.path));

  for (const raw of opts.ensureProjectPaths ?? []) {
    const path = raw?.trim();
    if (!path || seenPaths.has(path) || !existsSync(path)) continue;
    const hasMaou =
      existsSync(join(path, ".maou", "agents")) ||
      existsSync(join(path, ".maou", "project.json")) ||
      existsSync(join(path, ".maou"));
    if (!hasMaou) continue;
    seenPaths.add(path);
    projects.push({
      name: projectDisplayName(path),
      path,
      updated_at: new Date().toISOString(),
      isActive: true,
    } as (typeof projects)[number]);
  }

  const projectEntries: OpsAgentListEntry[] = [];
  for (const p of projects) {
    pushProjectAgents(projectEntries, p, now);
  }

  const mains = projectEntries.filter((e) => !e.parent);
  const children = projectEntries.filter((e) => !!e.parent);
  mains.sort((a, b) => {
    const ta = Date.parse(a.last_active_at ?? "") || 0;
    const tb = Date.parse(b.last_active_at ?? "") || 0;
    return tb - ta;
  });
  for (const m of mains) {
    out.push(m);
    for (const c of children.filter(
      (x) => x.project_path === m.project_path && x.parent === m.name,
    )) {
      out.push(c);
    }
  }

  return out;
}

/** 解析 switch_id（CLI / WebUI 共用） */
export function parseAgentSwitchId(id: string): {
  kind: "system" | "project";
  agentName: string;
  projectPath?: string;
} | null {
  if (id.startsWith("system:")) {
    return { kind: "system", agentName: id.slice("system:".length) };
  }
  if (id.startsWith("project:")) {
    // project:<path>:<agentName> — path 可能含冒号，从右侧拆
    const rest = id.slice("project:".length);
    const lastColon = rest.lastIndexOf(":");
    if (lastColon <= 0) return null;
    const projectPath = rest.slice(0, lastColon);
    const agentName = rest.slice(lastColon + 1);
    if (!projectPath || !agentName) return null;
    return { kind: "project", agentName, projectPath };
  }
  if (id && !id.includes("/")) {
    return { kind: "system", agentName: id };
  }
  return null;
}
