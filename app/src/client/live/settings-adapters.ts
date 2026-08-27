/**
 * Live settings view-model builders — pure, unit-testable.
 * Maps Meta + /api/models lists into production settings UI state.
 * Does NOT use draft showcase defaultApiConfig seeds.
 */
import type { ApprovalMode, Meta } from "../api";

export type LiveProviderOpt = { id: string; name?: string };
export type LiveModelOpt = { id: string; name?: string };

/**
 * Settings page sections (nav).
 * 「方案与审批」置顶：Agent 方案 + 模板默认 + 终端审批合一。
 */
export type LiveSettingsSectionId = "appearance" | "runtime_defaults" | "llm";

export const LIVE_SETTINGS_SECTIONS: ReadonlyArray<{
  id: LiveSettingsSectionId;
  label: string;
}> = [
  { id: "appearance", label: "外观" },
  { id: "runtime_defaults", label: "方案与审批" },
  { id: "llm", label: "LLM 模型" },
];

/** Backend-backed terminal approval modes (POST /api/approval). */
export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "normal",
  "auto",
  "yolo",
] as const;

export function isApprovalMode(v: string): v is ApprovalMode {
  return (APPROVAL_MODES as readonly string[]).includes(v);
}

export function approvalModeLabel(mode: string): string {
  switch (mode) {
    case "normal":
      return "普通（非白名单询问）";
    case "auto":
      return "自动（小模型审核）";
    case "yolo":
      return "YOLO（不询问）";
    default:
      return mode || "—";
  }
}

export function approvalModeHint(mode: string): string {
  switch (mode) {
    case "normal":
      return "非白名单终端命令需人工审批；黑名单直接拒绝。";
    case "auto":
      return "非白名单先由辅助模型审核；误报可再次执行同一命令通过。";
    case "yolo":
      return "忽略黑白名单与风险，全部自动放行（本机开发常用）。";
    default:
      return "选择终端工具审批策略。";
  }
}

/** Snapshot shown by production LiveSettingsPanel (backend-driven). */
export type LiveSettingsSnapshot = {
  provider: string;
  model: string;
  providers: LiveProviderOpt[];
  models: LiveModelOpt[];
  projectRoot: string;
  sandboxMode: string;
  approvalMode: string;
  agentName: string;
  offline: boolean;
  /** One-line status for the settings header */
  statusLabel: string;
};

export function emptyLiveSettingsSnapshot(
  offline = true,
): LiveSettingsSnapshot {
  return {
    provider: "",
    model: "",
    providers: [],
    models: [],
    projectRoot: "",
    sandboxMode: "—",
    approvalMode: "—",
    agentName: "coding",
    offline,
    statusLabel: offline ? "后端离线" : "未配置",
  };
}

/**
 * Build settings snapshot from live Meta + provider/model catalogs.
 * Prefers meta.providers / meta.models when catalog args empty.
 */
export function buildLiveSettingsSnapshot(
  meta: Meta | null,
  catalogs?: {
    providers?: LiveProviderOpt[];
    models?: LiveModelOpt[];
  },
): LiveSettingsSnapshot {
  if (!meta) return emptyLiveSettingsSnapshot(true);

  const providers =
    catalogs?.providers?.length
      ? catalogs.providers
      : (meta.providers ?? []).map((p) => ({
          id: p.id,
          name: p.name,
        }));

  const models =
    catalogs?.models?.length
      ? catalogs.models
      : (meta.models ?? []).map((m) => ({
          id: m.id,
          name: m.name,
        }));

  const provider = meta.provider || providers[0]?.id || "";
  const model = meta.model || models[0]?.id || "";
  const offline = !meta.provider && !meta.model && providers.length === 0;
  const approvalRaw = meta.approvalMode || meta.sandboxMode || "";
  const approvalMode = isApprovalMode(approvalRaw) ? approvalRaw : approvalRaw || "—";

  return {
    provider,
    model,
    providers,
    models,
    projectRoot: meta.projectRoot || "",
    sandboxMode: meta.sandboxMode || "—",
    approvalMode,
    agentName: meta.agentName || "coding",
    offline,
    statusLabel: offline
      ? "后端离线"
      : `${provider || "—"} · ${model || "—"} · ${approvalMode} · live`,
  };
}

/**
 * Patch approval mode on an existing snapshot (after successful setApproval).
 */
export function withApprovalMode(
  snap: LiveSettingsSnapshot,
  mode: ApprovalMode,
): LiveSettingsSnapshot {
  return {
    ...snap,
    approvalMode: mode,
    sandboxMode: mode,
    statusLabel: snap.offline
      ? snap.statusLabel
      : `${snap.provider || "—"} · ${snap.model || "—"} · ${mode} · live`,
  };
}

/**
 * When provider changes, pick a model that exists in the new catalog
 * (keep current if still valid, else first model).
 */
export function resolveModelAfterProviderChange(
  models: LiveModelOpt[],
  previousModel: string,
): string {
  if (!models.length) return "";
  if (previousModel && models.some((m) => m.id === previousModel)) {
    return previousModel;
  }
  return models[0]!.id;
}

/** True if string looks like a draft showcase seed key (must never be live SoT). */
export function isDraftShowcaseApiKey(key: string): boolean {
  return (
    /sk-draft-/i.test(key) ||
    /sk-ant-draft-/i.test(key) ||
    /example-key/i.test(key)
  );
}

/**
 * Detect showcase seed config shape (for structural tests / audit).
 * Real live settings must not present these as the user's config.
 */
export function looksLikeDraftShowcasePreset(p: {
  key?: string;
  model?: string;
  url?: string;
}): boolean {
  if (p.key && isDraftShowcaseApiKey(p.key)) return true;
  if (p.model === "gpt-5" && /api\.openai\.com/i.test(p.url || "")) return true;
  return false;
}
