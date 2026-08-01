/**
 * Live settings view-model builders — pure, unit-testable.
 * Maps Meta + /api/models lists into production settings UI state.
 * Does NOT use draft showcase defaultApiConfig seeds.
 */
import type { Meta } from "../api";

export type LiveProviderOpt = { id: string; name?: string };
export type LiveModelOpt = { id: string; name?: string };

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

  return {
    provider,
    model,
    providers,
    models,
    projectRoot: meta.projectRoot || "",
    sandboxMode: meta.sandboxMode || "—",
    approvalMode: meta.approvalMode || meta.sandboxMode || "—",
    agentName: meta.agentName || "coding",
    offline,
    statusLabel: offline
      ? "后端离线"
      : `${provider || "—"} · ${model || "—"} · live`,
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
