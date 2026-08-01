/**
 * Live API → draft shell prop adapters (production chrome).
 * Pure mappers — unit-testable without React.
 */
import type { Meta, TerminalInfo } from "../api";
import type { DraftAgent, DraftBgTask, DraftMeta } from "../drafts/types";

export function projectLabelFromRoot(projectRoot: string | undefined): string {
  if (!projectRoot) return "project";
  const parts = projectRoot.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "project";
}

export function projectPathLabel(projectRoot: string | undefined): string {
  if (!projectRoot) return "~/project";
  const parts = projectRoot.split("/").filter(Boolean);
  return `~/${parts.slice(-2).join("/")}`;
}

/** Map live Meta into DraftMeta for WireTopbar / BottomInfoBar. */
export function metaToDraftMeta(
  meta: Meta | null,
  opts?: { offline?: boolean },
): DraftMeta {
  if (!meta) {
    return {
      projectPath: "~/project",
      projectLabel: "project",
      agentName: "coding",
      sandboxMode: "—",
      provider: "",
      model: "",
      offline: true,
      tokenLabel: "connecting…",
    };
  }
  const offline = opts?.offline ?? false;
  return {
    projectPath: projectPathLabel(meta.projectRoot),
    projectLabel: projectLabelFromRoot(meta.projectRoot),
    agentName: meta.agentName || "coding",
    sandboxMode: meta.approvalMode || meta.sandboxMode || "yolo",
    provider: meta.provider || "",
    model: meta.model || "",
    offline,
    tokenLabel:
      meta.provider || meta.model
        ? `${meta.provider || "—"}${meta.model ? ` · ${meta.model}` : ""}`
        : "model offline",
  };
}

/**
 * Fallback when /api/agents is unavailable: single row from meta.
 * Prefer liveAgentsToDraftAgents when registry list is present.
 */
export function metaToAgents(
  meta: Meta | null,
  agentBusy: boolean,
): DraftAgent[] {
  const name = meta?.agentName || "coding";
  return [
    {
      id: `system:${name}`,
      name,
      displayName: name,
      role: "coding",
      status: agentBusy ? "running" : "idle",
      group: "system",
      overview: meta?.model
        ? `${meta.provider || "—"} · ${meta.model}`
        : meta?.provider || "live agent",
      projectPath: meta?.projectRoot,
      projectName: projectLabelFromRoot(meta?.projectRoot),
    },
  ];
}

/** Map GET /api/agents rows into DraftAgent props for AgentList. */
export function liveAgentsToDraftAgents(
  agents: Array<{
    id: string;
    name: string;
    displayName?: string;
    role?: string;
    status?: DraftAgent["status"];
    group?: "system" | "project" | string;
    parent?: string;
    projectPath?: string;
    projectName?: string;
    overview?: string;
    stale?: boolean;
    switchId?: string;
  }>,
  opts?: {
    activeAgentName?: string | null;
    activeSwitchId?: string | null;
    agentBusy?: boolean;
  },
): DraftAgent[] {
  const activeName = opts?.activeAgentName || "";
  const activeSwitch = opts?.activeSwitchId || "";
  return agents.map((a) => {
    const switchId = a.switchId || a.id || `system:${a.name}`;
    let status: DraftAgent["status"] = a.status ?? "idle";
    // Reflect shell busy onto active agent even if presence disk is stale
    const isActive =
      (activeSwitch && switchId === activeSwitch) ||
      (!activeSwitch && a.name === activeName);
    if (opts?.agentBusy && isActive && status === "idle") {
      status = "running";
    }
    return {
      // AgentList selects by id — use switch_id for multi-project uniqueness
      id: switchId,
      name: a.name,
      displayName: a.displayName || a.name,
      role: a.role || "agent",
      status,
      group: a.group === "project" ? "project" : "system",
      parent: a.parent || undefined,
      projectPath: a.projectPath,
      projectName: a.projectName,
      overview: a.overview,
      stale: a.stale,
    };
  });
}

/** One-line dock summaries from terminal list. */
export function terminalsToTermLines(
  terminals: TerminalInfo[],
  limit = 24,
): string[] {
  if (!terminals.length) return ["$ ready · no agent terminals"];
  return terminals.slice(0, limit).map((t) => {
    const state = t.state || "?";
    const cmd = (t.command || t.description || t.id).slice(0, 48);
    const agent = t.agentName || "agent";
    return `${state} · ${agent} · ${cmd}`;
  });
}

/** Map running terminals into dock task rows. */
export function terminalsToBgTasks(terminals: TerminalInfo[]): DraftBgTask[] {
  return terminals.map((t) => {
    const running =
      t.state === "running" ||
      t.state === "active" ||
      t.state === "open" ||
      t.exitCode === null;
    return {
      id: t.id,
      title: (t.description || t.command || t.id).slice(0, 64),
      status: running ? "running" : "done",
      agent: t.agentName || "coding",
    };
  });
}

export function usageLabelFromMeta(
  meta: Meta | null,
  agentBusy: boolean,
): string {
  if (!meta) return "connecting…";
  if (agentBusy) return "running";
  if (!meta.provider && !meta.model) return "offline";
  return meta.approvalMode || meta.sandboxMode || "ready";
}
