/**
 * Pure helpers for draft API settings (api.presets shape).
 * Field names align with core/llm APIPreset / CustomPreset / guardrails.
 * Session-local only — no live ConfigStore / disk writes.
 */
import type { DraftApiConfig, DraftApiPreset, DraftApiProtocol } from "./types";

export const API_PROTOCOLS: readonly DraftApiProtocol[] = [
  "openai",
  "anthropic",
  "openai-responses",
] as const;

export const PROTOCOL_LABEL: Record<DraftApiProtocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  "openai-responses": "OpenAI Responses",
};

/** Defaults aligned with maou setup + LLM guardrail defaults. */
export const DEFAULT_MAX_CONTEXT = 128_000;
export const DEFAULT_MAX_TOKENS = 32_768;

/** Capability / window defaults shared by seed + empty presets. */
export function defaultCapabilityFields(): Pick<
  DraftApiPreset,
  | "maxContext"
  | "maxTokens"
  | "supportsVision"
  | "supportsReasoning"
  | "nativeToolCalling"
> {
  return {
    maxContext: DEFAULT_MAX_CONTEXT,
    maxTokens: DEFAULT_MAX_TOKENS,
    supportsVision: true,
    supportsReasoning: true,
    nativeToolCalling: true,
  };
}

/** Normalize partial/legacy presets so capability fields always exist. */
export function normalizeApiPreset(
  p: Partial<DraftApiPreset> &
    Pick<DraftApiPreset, "name" | "url" | "key" | "model" | "protocol">,
): DraftApiPreset {
  const caps = defaultCapabilityFields();
  return {
    name: p.name,
    url: p.url,
    key: p.key,
    model: p.model,
    protocol: p.protocol,
    maxContext:
      typeof p.maxContext === "number" && Number.isFinite(p.maxContext)
        ? Math.max(0, Math.floor(p.maxContext))
        : caps.maxContext,
    maxTokens:
      typeof p.maxTokens === "number" && Number.isFinite(p.maxTokens)
        ? Math.max(0, Math.floor(p.maxTokens))
        : caps.maxTokens,
    supportsVision:
      typeof p.supportsVision === "boolean"
        ? p.supportsVision
        : caps.supportsVision,
    supportsReasoning:
      typeof p.supportsReasoning === "boolean"
        ? p.supportsReasoning
        : caps.supportsReasoning,
    nativeToolCalling:
      typeof p.nativeToolCalling === "boolean"
        ? p.nativeToolCalling
        : caps.nativeToolCalling,
  };
}

/** Human-readable capability chips for list/summary UI. */
export function capabilitySummary(p: DraftApiPreset): string {
  const bits: string[] = [];
  if (p.supportsVision) bits.push("视觉");
  if (p.supportsReasoning) bits.push("推理");
  if (p.nativeToolCalling) bits.push("工具");
  bits.push(`上下文 ${formatTokenCount(p.maxContext)}`);
  bits.push(`输出 ${formatTokenCount(p.maxTokens)}`);
  return bits.join(" · ");
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Seed presets for draft showcase — mirrors maou setup shape + capabilities. */
export function defaultApiConfig(): DraftApiConfig {
  const caps = defaultCapabilityFields();
  return {
    defaultPreset: 0,
    presets: [
      normalizeApiPreset({
        name: "openai",
        url: "https://api.openai.com/v1",
        key: "sk-draft-openai-example-key-0001",
        model: "gpt-5",
        protocol: "openai",
        ...caps,
      }),
      normalizeApiPreset({
        name: "anthropic",
        url: "https://api.anthropic.com",
        key: "sk-ant-draft-example-key-0002",
        model: "claude-sonnet-4",
        protocol: "anthropic",
        ...caps,
        // Anthropic setup typically enables reasoning
        supportsReasoning: true,
      }),
    ],
  };
}

export function cloneApiConfig(cfg: DraftApiConfig): DraftApiConfig {
  return {
    defaultPreset: cfg.defaultPreset,
    presets: cfg.presets.map((p) => normalizeApiPreset({ ...p })),
  };
}

export function emptyApiPreset(n = 1): DraftApiPreset {
  return normalizeApiPreset({
    name: `preset-${n}`,
    url: "https://api.openai.com/v1",
    key: "",
    model: "gpt-5",
    protocol: "openai",
    ...defaultCapabilityFields(),
  });
}

/**
 * Mask secret for display. Never returns the full key when length > 8.
 * Empty → "（未设置）"; short → full bullets; longer → prefix…suffix.
 */
export function maskApiKey(key: string | null | undefined): string {
  const k = (key ?? "").trim();
  if (!k) return "（未设置）";
  if (k.length <= 8) return "•".repeat(Math.min(k.length, 8));
  const head = k.slice(0, 3);
  const tail = k.slice(-4);
  return `${head}${"•".repeat(8)}${tail}`;
}

export type ApiPresetFieldErrors = Partial<
  Record<
    "name" | "url" | "model" | "protocol" | "maxContext" | "maxTokens",
    string
  >
>;

/** Identity + positive window sizes (key may be empty in draft). */
export function validateApiPreset(p: DraftApiPreset): ApiPresetFieldErrors {
  const err: ApiPresetFieldErrors = {};
  if (!p.name.trim()) err.name = "名称不能为空";
  if (!p.url.trim()) err.url = "URL 不能为空";
  else if (!/^https?:\/\//i.test(p.url.trim())) {
    err.url = "URL 需以 http:// 或 https:// 开头";
  }
  if (!p.model.trim()) err.model = "模型不能为空";
  if (!API_PROTOCOLS.includes(p.protocol)) {
    err.protocol = "未知协议";
  }
  if (!Number.isFinite(p.maxContext) || p.maxContext < 1024) {
    err.maxContext = "上下文窗口至少 1024";
  }
  if (!Number.isFinite(p.maxTokens) || p.maxTokens < 1) {
    err.maxTokens = "输出上限至少 1";
  }
  return err;
}

export function isApiPresetValid(p: DraftApiPreset): boolean {
  return Object.keys(validateApiPreset(p)).length === 0;
}

export function getDefaultPreset(
  cfg: DraftApiConfig,
): DraftApiPreset | null {
  if (cfg.presets.length === 0) return null;
  const i = Math.min(
    Math.max(0, cfg.defaultPreset),
    cfg.presets.length - 1,
  );
  return cfg.presets[i] ?? null;
}

export function addApiPreset(cfg: DraftApiConfig): DraftApiConfig {
  const next = cloneApiConfig(cfg);
  next.presets.push(emptyApiPreset(next.presets.length + 1));
  if (next.presets.length === 1) next.defaultPreset = 0;
  return next;
}

export function updateApiPreset(
  cfg: DraftApiConfig,
  index: number,
  patch: Partial<DraftApiPreset>,
): DraftApiConfig {
  if (index < 0 || index >= cfg.presets.length) return cfg;
  const next = cloneApiConfig(cfg);
  const cur = next.presets[index]!;
  next.presets[index] = normalizeApiPreset({
    ...cur,
    ...patch,
  });
  return next;
}

export function removeApiPreset(
  cfg: DraftApiConfig,
  index: number,
): DraftApiConfig {
  if (index < 0 || index >= cfg.presets.length) return cfg;
  if (cfg.presets.length <= 1) {
    return {
      defaultPreset: 0,
      presets: [emptyApiPreset(1)],
    };
  }
  const next = cloneApiConfig(cfg);
  next.presets.splice(index, 1);
  if (next.defaultPreset >= next.presets.length) {
    next.defaultPreset = next.presets.length - 1;
  } else if (index < next.defaultPreset) {
    next.defaultPreset -= 1;
  } else if (index === next.defaultPreset) {
    next.defaultPreset = Math.min(
      next.defaultPreset,
      next.presets.length - 1,
    );
  }
  return next;
}

export function setDefaultApiPreset(
  cfg: DraftApiConfig,
  index: number,
): DraftApiConfig {
  if (index < 0 || index >= cfg.presets.length) return cfg;
  return { ...cloneApiConfig(cfg), defaultPreset: index };
}

/** Whether two configs match field-for-field (order-sensitive). */
export function apiConfigsEqual(a: DraftApiConfig, b: DraftApiConfig): boolean {
  if (a.defaultPreset !== b.defaultPreset) return false;
  if (a.presets.length !== b.presets.length) return false;
  for (let i = 0; i < a.presets.length; i++) {
    const x = normalizeApiPreset(a.presets[i]!);
    const y = normalizeApiPreset(b.presets[i]!);
    if (
      x.name !== y.name ||
      x.url !== y.url ||
      x.key !== y.key ||
      x.model !== y.model ||
      x.protocol !== y.protocol ||
      x.maxContext !== y.maxContext ||
      x.maxTokens !== y.maxTokens ||
      x.supportsVision !== y.supportsVision ||
      x.supportsReasoning !== y.supportsReasoning ||
      x.nativeToolCalling !== y.nativeToolCalling
    ) {
      return false;
    }
  }
  return true;
}
