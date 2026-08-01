/**
 * Live agent list for webui — same source as default CLI `maou` agent page:
 * listOpsAgents (system agents + projects.json multi-project + children)
 * + presence lights from ~/.maou/run/agent-presence.json.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { listAgentsForCli } from "@little-house-studio/agent";

/** CLI-compatible user maou root (MAOU_HOME or ~/.maou). */
export function resolveUserMaouRoot(): string {
  const env = process.env.MAOU_HOME?.trim();
  if (env) return env;
  return join(homedir(), ".maou");
}

/** Ops workspace under maou root (default maouRoot itself for listAgentsForCli). */
export function resolveUserOpsRoot(userRoot?: string): string {
  const root = userRoot ?? resolveUserMaouRoot();
  const ops = join(root, "ops");
  return existsSync(ops) ? ops : root;
}

type ProjectListItem = {
  name: string;
  path: string;
  created_at?: string;
  updated_at?: string;
};

/** Read ~/.maou/projects.json (same file CLI getProjectsList uses). */
export function getProjectsList(userRoot?: string): ProjectListItem[] {
  const root = userRoot ?? resolveUserMaouRoot();
  try {
    const p = join(root, "projects.json");
    if (!existsSync(p)) return [];
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      projects?: ProjectListItem[];
    };
    if (!Array.isArray(raw.projects)) return [];
    return raw.projects.filter(
      (x) => x && typeof x.path === "string" && typeof x.name === "string",
    );
  } catch {
    return [];
  }
}

export type LiveAgentPresenceStatus =
  | "idle"
  | "running"
  | "done_unread"
  | "done_read"
  | "blocked"
  | "needs_reply";

/** Serializable agent row for GET /api/agents (DraftAgent-compatible + switch_id). */
export type LiveAgentDto = {
  id: string;
  name: string;
  displayName: string;
  role: string;
  status: LiveAgentPresenceStatus;
  group: "system" | "project";
  parent?: string;
  projectPath?: string;
  projectName?: string;
  overview?: string;
  stale?: boolean;
  /** CLI switch_id: system:<name> | project:<path>:<name> */
  switchId: string;
};

export type AgentPresenceDisk = {
  lastActiveAt?: number;
  lastViewedAt?: number;
  lastDoneAt?: number;
  running?: boolean;
  blocked?: boolean;
  needsReply?: boolean;
  overview?: string;
};

/** Ops-shaped registry row (before presence merge). */
export type OpsAgentListEntry = {
  name: string;
  display_name?: string;
  parent?: string;
  role?: string;
  description?: string;
  notes?: string;
  group?: "system" | "project";
  project_path?: string;
  project_name?: string;
  switch_id?: string;
  last_active_at?: string;
  stale?: boolean;
  has_subagents?: boolean;
  scope?: string;
  [k: string]: unknown;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function agentPresenceKey(
  agentName: string,
  projectRoot?: string | null,
): string {
  return projectRoot ? `${projectRoot}::${agentName}` : `system::${agentName}`;
}

export function presenceFilePath(maouRoot: string): string {
  return join(maouRoot, "run", "agent-presence.json");
}

export function loadPresenceMap(
  maouRoot: string,
): Record<string, AgentPresenceDisk> {
  try {
    const p = presenceFilePath(maouRoot);
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      agents?: Record<string, AgentPresenceDisk>;
    };
    if (!raw?.agents || typeof raw.agents !== "object") return {};
    return raw.agents;
  } catch {
    return {};
  }
}

export function resolveLivePresenceStatus(
  disk: AgentPresenceDisk | undefined,
  opts: {
    isCurrent: boolean;
    agentBusy?: boolean;
    hasPendingApproval?: boolean;
    stale?: boolean;
  },
): LiveAgentPresenceStatus {
  if (opts.stale) return "idle";
  const p = disk ?? {};
  if (opts.isCurrent) {
    if (opts.hasPendingApproval) return "blocked";
    if (opts.agentBusy || p.running) return "running";
    if (
      (p.lastDoneAt ?? 0) > 0 &&
      (p.lastViewedAt ?? 0) < (p.lastDoneAt ?? 0)
    ) {
      return "done_unread";
    }
    if (p.needsReply) return "needs_reply";
    if ((p.lastDoneAt ?? 0) > 0) return "done_read";
    return "idle";
  }
  if (p.blocked) return "blocked";
  if (p.running) return "running";
  if (
    (p.lastDoneAt ?? 0) > 0 &&
    (p.lastViewedAt ?? 0) < (p.lastDoneAt ?? 0)
  ) {
    return "done_unread";
  }
  if (p.needsReply) return "needs_reply";
  if ((p.lastDoneAt ?? 0) > 0) return "done_read";
  return "idle";
}

/**
 * Default CLI-aligned switch_id for a hub session:
 * - If projectRoot has .maou/agents/<agentName> (or is a registered project path),
 *   use project:<projectRoot>:<agentName>
 * - Else system:<agentName>
 */
export function resolveDefaultSwitchId(
  projectRoot: string,
  agentName: string,
  maouRoot?: string,
): { switchId: string; projectPath: string | null } {
  const name = (agentName || "coding").trim() || "coding";
  const root = projectRoot?.trim() || process.cwd();
  const agentDir = join(root, ".maou", "agents", name);
  const maouDir = join(root, ".maou");
  let isProject = existsSync(agentDir) || existsSync(join(maouDir, "project.json"));
  if (!isProject && maouRoot) {
    try {
      const projects = getProjectsList(maouRoot);
      isProject = projects.some((p) => p.path === root);
    } catch {
      /* ignore */
    }
  }
  if (isProject) {
    return {
      switchId: `project:${root}:${name}`,
      projectPath: root,
    };
  }
  // Prefer system:main when agent is coding but only main exists in registry — keep name as-is
  return { switchId: `system:${name}`, projectPath: null };
}

/** Parse CLI switch_id (same rules as ops-agent parseAgentSwitchId). */
export function parseAgentSwitchId(id: string): {
  kind: "system" | "project";
  agentName: string;
  projectPath?: string;
} | null {
  if (id.startsWith("system:")) {
    return { kind: "system", agentName: id.slice("system:".length) };
  }
  if (id.startsWith("project:")) {
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

function agentDirMtime(dir: string): string | undefined {
  try {
    return new Date(statSync(dir).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
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

function loadOverview(agentDir: string, fallback = ""): string {
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
 * Append one project's main + sub agents (same shape as CLI listOpsAgents).
 */
function pushProjectAgents(
  projectEntries: OpsAgentListEntry[],
  p: ProjectListItem,
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
    projectEntries.push({
      name: "coding",
      display_name: p.name,
      role: "coding",
      group: "project",
      project_path: p.path,
      project_name: p.name,
      switch_id: `project:${p.path}:coding`,
      last_active_at: last ?? p.updated_at,
      stale: lastMs > 0 ? now - lastMs > SEVEN_DAYS_MS : false,
      notes: "尚未驻扎 coding agent；切换后将自动物化",
      description: p.path,
    });
    return;
  }

  const agentDir = join(p.path, ".maou", "agents", mainName);
  const last = agentDirMtime(agentDir) ?? p.updated_at;
  const lastMs = last ? Date.parse(last) : 0;
  const subs = names.filter((n) => n !== mainName);
  const overview = loadOverview(agentDir, p.path);

  projectEntries.push({
    name: mainName,
    display_name: p.name,
    role: "coding",
    group: "project",
    project_path: p.path,
    project_name: p.name,
    switch_id: `project:${p.path}:${mainName}`,
    last_active_at: last,
    stale: lastMs > 0 ? now - lastMs > SEVEN_DAYS_MS : false,
    description: overview,
    notes: overview,
  });

  for (const sub of subs) {
    const sdir = join(p.path, ".maou", "agents", sub);
    const slast = agentDirMtime(sdir);
    const so = loadOverview(sdir, `${p.name} / ${sub}`);
    projectEntries.push({
      name: sub,
      display_name: sub,
      role: "subagent",
      parent: mainName,
      group: "project",
      project_path: p.path,
      project_name: p.name,
      switch_id: `project:${p.path}:${sub}`,
      last_active_at: slast,
      stale: false,
      description: so,
      notes: so,
    });
  }
}

/**
 * Same list construction as agent/ops-agent listOpsAgents (CLI default agent page).
 * Pure-ish: reads maouRoot FS; unit-testable with temp dirs.
 *
 * @param ensureProjectPaths  extra project roots to include even if not in
 *   projects.json (e.g. webui hub cwd / active switch project) so current
 *   selection is always visible — CLI registers via `maou coding` gate.
 */
export function listOpsAgentsForWeb(
  maouRoot?: string,
  ensureProjectPaths?: string[],
): OpsAgentListEntry[] {
  const root = maouRoot ?? resolveUserMaouRoot();
  const opsRoot = resolveUserOpsRoot(root);
  const out: OpsAgentListEntry[] = [];
  const now = Date.now();

  try {
    const system = listAgentsForCli(root, opsRoot) as OpsAgentListEntry[];
    for (const e of system) {
      const dir = join(root, "agents", e.name);
      const last = agentDirMtime(dir);
      const lastMs = last ? Date.parse(last) : 0;
      const overview = loadOverview(
        dir,
        String(e.description || e.notes || "机器级助手"),
      );
      out.push({
        ...e,
        group: "system",
        switch_id: `system:${e.name}`,
        last_active_at: last,
        stale: lastMs > 0 ? now - lastMs > SEVEN_DAYS_MS : false,
        description: overview,
        notes: overview,
      });
    }
  } catch {
    /* ignore */
  }

  if (!out.some((e) => e.name === "ops" && e.group === "system")) {
    out.unshift({
      name: "ops",
      display_name: "Ops Agent",
      role: "ops",
      group: "system",
      switch_id: "system:ops",
      description: "机器级电脑管家",
      notes: "",
    });
  }

  const projects = getProjectsList(root).filter((p) => existsSync(p.path));
  const seenPaths = new Set(projects.map((p) => p.path));

  // Hub / active workspace may not be in projects.json yet (CLI registers on
  // `maou coding` confirm). Still surface it so web activeSwitchId ∈ list.
  for (const raw of ensureProjectPaths ?? []) {
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
    });
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

/**
 * Map ops-shaped entries + presence → LiveAgentDto.
 * Presence key: system agents → system::name; project → projectPath::name
 * (CLI overlay agentPresenceKey(name, project_path ?? null)).
 */
export function mapOpsEntriesToLiveAgents(
  entries: OpsAgentListEntry[],
  opts: {
    activeSwitchId?: string | null;
    activeAgentName?: string | null;
    activeProjectPath?: string | null;
    agentBusy?: boolean;
    hasPendingApproval?: boolean;
    presence?: Record<string, AgentPresenceDisk>;
  },
): LiveAgentDto[] {
  const presence = opts.presence ?? {};
  const out: LiveAgentDto[] = [];

  for (const e of entries) {
    const name = String(e.name || "").trim();
    if (!name) continue;
    const group: "system" | "project" =
      e.group === "project" ? "project" : "system";
    const projectPath =
      group === "project"
        ? String(e.project_path || "") || undefined
        : undefined;
    // CLI: project_path only for project group; system → null key → system::name
    const presenceProject =
      group === "project" ? projectPath ?? null : null;
    const key = agentPresenceKey(name, presenceProject);
    const switchId =
      String(e.switch_id || "") ||
      (group === "project" && projectPath
        ? `project:${projectPath}:${name}`
        : `system:${name}`);

    const isCurrent = opts.activeSwitchId
      ? switchId === opts.activeSwitchId
      : name === (opts.activeAgentName || "") &&
        (group === "system"
          ? !opts.activeProjectPath
          : projectPath === opts.activeProjectPath);

    const status = resolveLivePresenceStatus(presence[key], {
      isCurrent,
      agentBusy: opts.agentBusy,
      hasPendingApproval: opts.hasPendingApproval,
      stale: Boolean(e.stale),
    });

    out.push({
      id: switchId,
      name,
      displayName: String(e.display_name || name),
      role: String(e.role || "agent"),
      status,
      group,
      parent: e.parent ? String(e.parent) : undefined,
      projectPath,
      projectName:
        group === "project"
          ? String(e.project_name || projectPath || "")
          : undefined,
      overview: String(
        presence[key]?.overview || e.notes || e.description || e.role || "",
      ).slice(0, 80),
      stale: Boolean(e.stale),
      switchId,
    });
  }

  if (out.length === 0) {
    const active = opts.activeAgentName || "coding";
    const key = agentPresenceKey(active, null);
    const switchId = `system:${active}`;
    out.push({
      id: switchId,
      name: active,
      displayName: active,
      role: "coding",
      status: resolveLivePresenceStatus(presence[key], {
        isCurrent: true,
        agentBusy: opts.agentBusy,
        hasPendingApproval: opts.hasPendingApproval,
      }),
      group: "system",
      overview: "current agent",
      switchId,
    });
  }

  return out;
}

/** Full live list: ops agents + presence (CLI agent page source). */
export function listLiveAgents(opts: {
  maouRoot: string;
  projectRoot: string;
  activeSwitchId?: string | null;
  activeAgentName?: string | null;
  activeProjectPath?: string | null;
  agentBusy?: boolean;
  hasPendingApproval?: boolean;
}): LiveAgentDto[] {
  const maou = opts.maouRoot || resolveUserMaouRoot();
  // Ensure hub cwd + active project path appear even if not yet in projects.json
  const ensure: string[] = [];
  if (opts.projectRoot?.trim()) ensure.push(opts.projectRoot.trim());
  if (opts.activeProjectPath?.trim()) ensure.push(opts.activeProjectPath.trim());
  // Parse project path out of activeSwitchId when set
  if (opts.activeSwitchId) {
    const parsed = parseAgentSwitchId(opts.activeSwitchId);
    if (parsed?.kind === "project" && parsed.projectPath) {
      ensure.push(parsed.projectPath);
    }
  }
  const entries = listOpsAgentsForWeb(maou, ensure);
  const presence = loadPresenceMap(maou);
  return mapOpsEntriesToLiveAgents(entries, {
    activeSwitchId: opts.activeSwitchId,
    activeAgentName: opts.activeAgentName,
    activeProjectPath: opts.activeProjectPath,
    agentBusy: opts.agentBusy,
    hasPendingApproval: opts.hasPendingApproval,
    presence,
  });
}

/** @deprecated alias — tests may still import mapRegistryEntriesToLiveAgents */
export function mapRegistryEntriesToLiveAgents(
  entries: OpsAgentListEntry[],
  opts: {
    projectRoot: string;
    activeAgentName?: string;
    agentBusy?: boolean;
    hasPendingApproval?: boolean;
    presence?: Record<string, AgentPresenceDisk>;
  },
): LiveAgentDto[] {
  // Normalize bare registry rows into ops shape (system if no project path)
  const normalized: OpsAgentListEntry[] = entries.map((e) => {
    const project =
      e.group === "project" ||
      e._source === "project" ||
      e.scope === "project" ||
      Boolean(e.project_path);
    const projectPath = project
      ? String(e.project_path || opts.projectRoot)
      : undefined;
    return {
      ...e,
      group: project ? "project" : "system",
      project_path: projectPath,
      switch_id:
        e.switch_id ||
        (project && projectPath
          ? `project:${projectPath}:${e.name}`
          : `system:${e.name}`),
    };
  });
  return mapOpsEntriesToLiveAgents(normalized, {
    activeAgentName: opts.activeAgentName,
    activeProjectPath: null,
    agentBusy: opts.agentBusy,
    hasPendingApproval: opts.hasPendingApproval,
    presence: opts.presence,
  });
}
