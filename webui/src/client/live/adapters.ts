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

/** Single live coding agent row for AgentList (multi-agent hub optional later). */
export function metaToAgents(
  meta: Meta | null,
  agentBusy: boolean,
): DraftAgent[] {
  const name = meta?.agentName || "coding";
  return [
    {
      id: "live-primary",
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
