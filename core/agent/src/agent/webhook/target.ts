/**
 * webhook 目标解析 —— 短名 / switch_id → 可投递 agent。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getProjectsList } from "@little-house-studio/types";
import {
  isAllowedSystemAgent,
  isCodingAgentIdentity,
  isStationedAffiliateAgentName,
} from "../agent-identity.js";
import { parseAgentSwitchId } from "../list-ops-agents.js";

export type WebhookAgentRef = {
  name: string;
  switchId: string;
  projectPath?: string;
};

export type WebhookTarget = {
  switchId: string;
  agentName: string;
  projectPath: string | null;
};

export class WebhookResolveError extends Error {
  readonly status: 400 | 404 | 409;
  readonly candidates?: WebhookTarget[];

  constructor(
    message: string,
    status: 400 | 404 | 409,
    candidates?: WebhookTarget[],
  ) {
    super(message);
    this.name = "WebhookResolveError";
    this.status = status;
    this.candidates = candidates;
  }
}

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

export function targetFromSwitchId(switchId: string): WebhookTarget {
  const parsed = parseAgentSwitchId(switchId);
  if (!parsed?.agentName) {
    throw new WebhookResolveError(`invalid agent: ${switchId}`, 400);
  }
  if (isStationedAffiliateAgentName(parsed.agentName)) {
    throw new WebhookResolveError(
      `agent not switchable: ${parsed.agentName}`,
      400,
    );
  }
  if (parsed.kind === "project" && parsed.projectPath) {
    return {
      switchId: `project:${parsed.projectPath}:${parsed.agentName}`,
      agentName: parsed.agentName,
      projectPath: parsed.projectPath,
    };
  }
  return {
    switchId: `system:${parsed.agentName}`,
    agentName: parsed.agentName,
    projectPath: null,
  };
}

export function resolveWebhookTarget(opts: {
  raw?: string | null;
  agents: WebhookAgentRef[];
  activeSwitchId: string;
  bootProjectRoot: string;
  maouRoot: string;
}): WebhookTarget {
  const raw = String(opts.raw ?? "").trim();
  if (!raw) {
    if (opts.activeSwitchId.trim()) {
      return targetFromSwitchId(opts.activeSwitchId);
    }
    const def = resolveDefaultSwitchId(
      opts.bootProjectRoot,
      "coding",
      opts.maouRoot,
    );
    return targetFromSwitchId(def.switchId);
  }

  if (raw.startsWith("system:") || raw.startsWith("project:")) {
    return targetFromSwitchId(raw);
  }

  const exact = opts.agents.find((a) => a.switchId === raw);
  if (exact) return targetFromSwitchId(exact.switchId);

  const matches = opts.agents.filter((a) => a.name === raw);
  if (matches.length === 1) {
    return targetFromSwitchId(matches[0]!.switchId);
  }
  if (matches.length > 1) {
    const active = matches.find((a) => a.switchId === opts.activeSwitchId);
    if (active) return targetFromSwitchId(active.switchId);
    const boot = matches.find((a) => a.projectPath === opts.bootProjectRoot);
    if (boot) return targetFromSwitchId(boot.switchId);
    throw new WebhookResolveError(
      `ambiguous agent: ${raw}`,
      409,
      matches.map((a) => targetFromSwitchId(a.switchId)),
    );
  }

  if (isStationedAffiliateAgentName(raw)) {
    throw new WebhookResolveError(`agent not switchable: ${raw}`, 400);
  }

  const def = resolveDefaultSwitchId(opts.bootProjectRoot, raw, opts.maouRoot);
  if (
    def.switchId === "system:ops" &&
    raw !== "ops" &&
    !isAllowedSystemAgent(raw)
  ) {
    throw new WebhookResolveError(`unknown agent: ${raw}`, 404);
  }
  return targetFromSwitchId(def.switchId);
}
