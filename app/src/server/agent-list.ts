/**
 * Live agent list for webui — registry 列表权威在 @little-house-studio/agent
 * （listOpsAgents / agent-identity），此处叠加 presence 灯与 LiveAgentDto。
 *
 * 产品模型：system=ops；project=coding。附属（proactive 等）不当自由人。
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  listOpsAgents,
  parseAgentSwitchId,
  isCodingAgentIdentity,
  isAllowedSystemAgent,
  isStationedAffiliateAgentName,
  type OpsAgentListEntry,
} from "@little-house-studio/agent";

export {
  listOpsAgents,
  parseAgentSwitchId,
  isCodingAgentIdentity,
  isAllowedSystemAgent,
  isStationedAffiliateAgentName,
};
export type { OpsAgentListEntry };

/** CLI-compatible user maou root (MAOU_HOME or ~/.maou). */
export function resolveUserMaouRoot(): string {
  const env = process.env.MAOU_HOME?.trim();
  if (env) return env;
  return join(homedir(), ".maou");
}

/** Ops workspace under maou root. */
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
 * - coding 永远 project switch（禁止 system:coding）
 * - 其它 system 仅 isAllowedSystemAgent
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
  let isProject =
    existsSync(agentDir) || existsSync(join(maouDir, "project.json"));
  if (!isProject && maouRoot) {
    try {
      const projects = getProjectsList(maouRoot);
      isProject = projects.some((p) => p.path === root);
    } catch {
      /* ignore */
    }
  }
  if (isCodingAgentIdentity(name)) {
    if (existsSync(root)) {
      return { switchId: `project:${root}:${name}`, projectPath: root };
    }
    return { switchId: "system:ops", projectPath: null };
  }
  if (isProject) {
    return { switchId: `project:${root}:${name}`, projectPath: root };
  }
  if (!isAllowedSystemAgent(name)) {
    return { switchId: "system:ops", projectPath: null };
  }
  return { switchId: `system:${name}`, projectPath: null };
}

/**
 * Same list construction as agent-products/ops-agent listOpsAgents（core 权威）。
 */
export function listOpsAgentsForWeb(
  maouRoot?: string,
  ensureProjectPaths?: string[],
): OpsAgentListEntry[] {
  return listOpsAgents({
    maouRoot: maouRoot ?? resolveUserMaouRoot(),
    ensureProjectPaths,
  });
}

/**
 * Map ops-shaped entries + presence → LiveAgentDto.
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
    // 附属驻扎 agent 永不出现在可切换主体列表
    if (isStationedAffiliateAgentName(name)) continue;
    let group: "system" | "project" =
      e.group === "project" ? "project" : "system";
    // 安全网：coding 身份绝不能进 system
    if (
      group === "system" &&
      isCodingAgentIdentity(
        name,
        String(e.role || ""),
        String(e.display_name || ""),
      )
    ) {
      continue;
    }
    const projectPath =
      group === "project"
        ? String(e.project_path || "") || undefined
        : undefined;
    const presenceProject = group === "project" ? projectPath ?? null : null;
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
    const key = agentPresenceKey("ops", null);
    const switchId = "system:ops";
    out.push({
      id: switchId,
      name: "ops",
      displayName: "Ops Agent",
      role: "ops",
      status: resolveLivePresenceStatus(presence[key], {
        isCurrent: true,
        agentBusy: opts.agentBusy,
        hasPendingApproval: opts.hasPendingApproval,
      }),
      group: "system",
      overview: "机器级电脑管家",
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
  const ensure: string[] = [];
  if (opts.projectRoot?.trim()) ensure.push(opts.projectRoot.trim());
  if (opts.activeProjectPath?.trim()) ensure.push(opts.activeProjectPath.trim());
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
  const normalized: OpsAgentListEntry[] = entries.map((e) => {
    const name = String(e.name || "");
    const coding = isCodingAgentIdentity(
      name,
      String(e.role || ""),
      String(e.display_name || ""),
    );
    const project =
      coding ||
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
