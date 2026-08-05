/**
 * api.presets 多模型支持：
 * - 磁盘：每个 preset（厂商连接）必须含 models[]（至少一项）
 * - 运行时：展开为扁平 LLMPreset[]（每项一个 model），供 resolveApiRolePreset / LLMClient
 *
 * 不再兼容旧版「顶层 model、无 models[]」格式；请将配置迁移为 models[]。
 *
 * 注意：本文件不 import index.js，避免与 ConfigStore 循环依赖。
 */

/** 厂商 preset 内的单模型条目 */
export interface LLMModelSpec {
  /** 发给厂商的 model id */
  id: string;
  /**
   * 角色引用用的短名（可选）。
   * 多模型时运行时 name = `${preset.name}/${name || id}`
   */
  name?: string;
  maxTokens?: number;
  maxContext?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  nativeToolCalling?: boolean;
  nativeStructuredOutput?: boolean;
  inputPrice?: number;
  outputPrice?: number;
  cacheHitPrice?: number;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  extraBody?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 磁盘上的 preset：必须含 models[] */
export type LLMPresetDisk = Record<string, unknown> & {
  name?: string;
  url?: string;
  key?: string;
  /** 可选：等于 defaultModel，便于展示；运行时以 models[].id 为准 */
  model?: string;
  models: LLMModelSpec[];
  defaultModel?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function pickModelId(m: unknown): string {
  const r = asRecord(m);
  if (!r) return "";
  return String(r.id ?? r.model ?? r.name ?? "").trim();
}

/**
 * 将一条磁盘 preset 展开为 1..N 条运行时 LLMPreset（每条含确定的 model 字段）。
 * 无 models[] 或 models 为空 → 返回 []（不兼容旧扁平格式）。
 */
export function expandPresetModels(raw: unknown): Array<Record<string, unknown>> {
  const p = asRecord(raw);
  if (!p) return [];

  const providerName = String(p.name ?? "").trim() || "preset";
  const modelsRaw = Array.isArray(p.models) ? p.models : null;
  if (!modelsRaw || modelsRaw.length === 0) {
    return [];
  }

  const entries = modelsRaw
    .map((m) => {
      const id = pickModelId(m);
      if (!id) return null;
      const mr = asRecord(m)!;
      const alias = String(mr.name ?? "").trim();
      return { id, alias, mr };
    })
    .filter(Boolean) as Array<{
    id: string;
    alias: string;
    mr: Record<string, unknown>;
  }>;

  if (entries.length === 0) return [];

  return entries.map((e, idx) => {
    // 优先保留磁盘上的 presetName（折叠时写入，避免 roles 绑定名丢失）
    const preserved = String(e.mr.presetName ?? e.mr.runtimeName ?? "").trim();
    // 单模型：保留 provider name，兼容 roles: "ds-flash"
    // 多模型：name = provider/alias|id
    const runtimeName =
      preserved ||
      (entries.length === 1
        ? providerName
        : `${providerName}/${e.alias || e.id}`);

    const shared = { ...p };
    delete shared.models;
    delete shared.defaultModel;

    const out: Record<string, unknown> = {
      ...shared,
      name: runtimeName,
      model: e.id,
      // 模型级覆盖
      maxTokens: e.mr.maxTokens ?? e.mr.max_tokens ?? p.maxTokens,
      maxContext: e.mr.maxContext ?? e.mr.max_context ?? p.maxContext,
      supportsVision:
        e.mr.supportsVision ?? e.mr.supports_vision ?? p.supportsVision,
      supportsReasoning:
        e.mr.supportsReasoning ??
        e.mr.supports_reasoning ??
        p.supportsReasoning,
      supportsAudio:
        e.mr.supportsAudio ?? e.mr.supports_audio ?? p.supportsAudio,
      supportsVideo:
        e.mr.supportsVideo ?? e.mr.supports_video ?? p.supportsVideo,
      nativeToolCalling:
        e.mr.nativeToolCalling ??
        e.mr.native_tool_calling ??
        p.nativeToolCalling,
      nativeStructuredOutput:
        e.mr.nativeStructuredOutput ?? p.nativeStructuredOutput,
    };

    // 价格 / 采样 可选覆盖
    for (const k of [
      "inputPrice",
      "outputPrice",
      "cacheHitPrice",
      "input_price",
      "output_price",
      "cache_hit_price",
      "temperature",
      "topP",
      "top_p",
      "presencePenalty",
      "presence_penalty",
      "frequencyPenalty",
      "frequency_penalty",
      "maxConcurrent",
      "max_concurrent",
      "extraBody",
      "pricing",
    ] as const) {
      if (e.mr[k] !== undefined) out[k] = e.mr[k];
    }

    // 标记展开来源（调试 / UI 反推）
    out._providerName = providerName;
    out._modelIndex = idx;

    return out;
  });
}

/**
 * 规范为运行时扁平列表（两入口，语义不同，勿当「旧磁盘兼容」）：
 * - **磁盘嵌套**：有 models[] → expandPresetModels
 * - **运行时扁平**：已有 model、无 models[] → pass-through（save 合并 / 已 expand 的 APIPreset）
 *
 * 磁盘旧扁平（仅顶层 model）应先 migratePresetsToNested，再进入本函数。
 */
export function coerceToRuntimePresets(
  raw: unknown,
): Array<Record<string, unknown>> {
  const p = asRecord(raw);
  if (!p) return [];
  if (Array.isArray(p.models) && p.models.length > 0) {
    return expandPresetModels(p);
  }
  // 运行时扁平 pass-through（不是磁盘 legacy 格式）
  if (String(p.model ?? "").trim()) {
    const out = { ...p };
    if (!String(out.name ?? "").trim()) {
      out.name = String(out.model);
    }
    return [out];
  }
  return [];
}

/** 展开整个 presets 数组（磁盘 models[] 或运行时扁平 pass-through） */
export function expandAllPresets(rawList: unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const item of rawList) {
    out.push(...coerceToRuntimePresets(item));
  }
  return out;
}

/**
 * 将扁平运行时 preset 列表折叠回「厂商 + models[]」（按 url|protocol|vendor 分组）。
 * 用于 WebUI 保存 / 迁移。落盘只写 models[]（+ defaultModel），不写旧式顶层-only model。
 */
export function collapsePresetsToNested(
  flat: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  type Bucket = {
    key: string;
    base: Record<string, unknown>;
    models: LLMModelSpec[];
    order: number;
  };
  const buckets = new Map<string, Bucket>();
  let order = 0;

  for (const p of flat) {
    const protocol = String(p.protocol ?? "openai");
    const vendor = String(p.vendor ?? "");
    const url = String(p.url ?? "").trim();
    const key = `${protocol}|${vendor}|${url}`;
    const modelId = String(p.model ?? "").trim();
    if (!modelId) continue;

    let b = buckets.get(key);
    if (!b) {
      const providerName = String(
        p._providerName ??
          (String(p.name ?? "").includes("/")
            ? String(p.name).split("/")[0]
            : p.name) ??
          modelId,
      ).trim();
      const base: Record<string, unknown> = { ...p };
      // 连接级保留；模型级字段放到 models[]
      delete base.model;
      delete base.models;
      delete base.defaultModel;
      delete base._providerName;
      delete base._modelIndex;
      delete base.maxTokens;
      delete base.maxContext;
      delete base.supportsVision;
      delete base.supportsReasoning;
      delete base.supportsAudio;
      delete base.supportsVideo;
      delete base.nativeToolCalling;
      delete base.nativeStructuredOutput;
      delete base.inputPrice;
      delete base.outputPrice;
      delete base.cacheHitPrice;
      delete base.temperature;
      delete base.topP;
      delete base.top_p;
      delete base.presencePenalty;
      delete base.presence_penalty;
      delete base.frequencyPenalty;
      delete base.frequency_penalty;
      delete base.extraBody;
      delete base.pricing;
      base.name = providerName;
      b = { key, base, models: [], order: order++ };
      buckets.set(key, b);
    }

    const alias =
      String(p.name ?? "").includes("/")
        ? String(p.name).split("/").slice(1).join("/")
        : undefined;

    const entry: LLMModelSpec = {
      id: modelId,
      ...(alias && alias !== modelId ? { name: alias } : {}),
      // 保留扁平 runtime 的 name，展开时优先还原（roles 绑定不丢）
      presetName: String(p.name ?? "").trim() || undefined,
    };
    // 每模型独立字段
    if (p.maxTokens != null) entry.maxTokens = Number(p.maxTokens);
    if (p.maxContext != null) entry.maxContext = Number(p.maxContext);
    if (p.supportsVision != null) entry.supportsVision = Boolean(p.supportsVision);
    if (p.supportsReasoning != null)
      entry.supportsReasoning = Boolean(p.supportsReasoning);
    if (p.supportsAudio != null) entry.supportsAudio = Boolean(p.supportsAudio);
    if (p.supportsVideo != null) entry.supportsVideo = Boolean(p.supportsVideo);
    if (p.nativeToolCalling != null)
      entry.nativeToolCalling = Boolean(p.nativeToolCalling);
    if (p.nativeStructuredOutput != null)
      entry.nativeStructuredOutput = Boolean(p.nativeStructuredOutput);
    if (p.inputPrice != null) entry.inputPrice = Number(p.inputPrice);
    if (p.outputPrice != null) entry.outputPrice = Number(p.outputPrice);
    if (p.cacheHitPrice != null) entry.cacheHitPrice = Number(p.cacheHitPrice);
    if (p.temperature != null) entry.temperature = Number(p.temperature);
    if (p.topP != null || p.top_p != null)
      entry.topP = Number(p.topP ?? p.top_p);
    if (p.extraBody != null && typeof p.extraBody === "object") {
      entry.extraBody = p.extraBody as Record<string, unknown>;
    }
    if (p.pricing != null && typeof p.pricing === "object") {
      entry.pricing = p.pricing;
    }

    b.models.push(entry);
  }

  return [...buckets.values()]
    .sort((a, b) => a.order - b.order)
    .map((b) => {
      const defaultId = b.models[0]?.id;
      return {
        ...b.base,
        models: b.models,
        ...(defaultId ? { defaultModel: defaultId } : {}),
      };
    });
}

/** 是否为多模型磁盘 preset（未展开） */
export function isMultiModelPreset(raw: unknown): boolean {
  const p = asRecord(raw);
  return Boolean(p && Array.isArray(p.models) && p.models.length > 0);
}

/**
 * 一次性迁移：旧扁平 preset（有 model、无 models[]）→ models[] 嵌套。
 * 已是新格式的条目原样返回。用于改文件 / 启动自愈。
 */
export function migratePresetToNested(
  raw: unknown,
): Record<string, unknown> | null {
  const p = asRecord(raw);
  if (!p) return null;

  const modelsRaw = Array.isArray(p.models) ? p.models : null;
  if (modelsRaw && modelsRaw.length > 0) {
    // 已有 models[]：清理为标准嵌套（保留连接字段 + models）
    const defaultId =
      String(p.defaultModel ?? "").trim() ||
      pickModelId(modelsRaw[0]) ||
      String(p.model ?? "").trim();
    const out: Record<string, unknown> = { ...p };
    if (defaultId) out.defaultModel = defaultId;
    // 顶层 model 不再作为唯一来源；可删以免混淆
    delete out.model;
    return out;
  }

  const modelId = String(p.model ?? "").trim();
  if (!modelId) return null;

  const entry: LLMModelSpec = { id: modelId };
  if (p.maxTokens != null) entry.maxTokens = Number(p.maxTokens);
  if (p.maxContext != null) entry.maxContext = Number(p.maxContext);
  if (p.supportsVision != null) entry.supportsVision = Boolean(p.supportsVision);
  if (p.supportsReasoning != null)
    entry.supportsReasoning = Boolean(p.supportsReasoning);
  if (p.supportsAudio != null) entry.supportsAudio = Boolean(p.supportsAudio);
  if (p.supportsVideo != null) entry.supportsVideo = Boolean(p.supportsVideo);
  if (p.nativeToolCalling != null)
    entry.nativeToolCalling = Boolean(p.nativeToolCalling);
  if (p.nativeStructuredOutput != null)
    entry.nativeStructuredOutput = Boolean(p.nativeStructuredOutput);
  if (p.inputPrice != null) entry.inputPrice = Number(p.inputPrice);
  if (p.outputPrice != null) entry.outputPrice = Number(p.outputPrice);
  if (p.cacheHitPrice != null) entry.cacheHitPrice = Number(p.cacheHitPrice);
  if (p.temperature != null) entry.temperature = Number(p.temperature);
  if (p.topP != null || p.top_p != null) entry.topP = Number(p.topP ?? p.top_p);
  if (p.extraBody != null && typeof p.extraBody === "object") {
    entry.extraBody = p.extraBody as Record<string, unknown>;
  }
  if (p.pricing != null && typeof p.pricing === "object") {
    entry.pricing = p.pricing;
  }
  // 单模型：runtime name 保持 preset.name
  entry.presetName = String(p.name ?? "").trim() || undefined;

  const base: Record<string, unknown> = { ...p };
  for (const k of [
    "model",
    "models",
    "defaultModel",
    "maxTokens",
    "maxContext",
    "supportsVision",
    "supportsReasoning",
    "supportsAudio",
    "supportsVideo",
    "nativeToolCalling",
    "nativeStructuredOutput",
    "inputPrice",
    "outputPrice",
    "cacheHitPrice",
    "temperature",
    "topP",
    "top_p",
    "presencePenalty",
    "presence_penalty",
    "frequencyPenalty",
    "frequency_penalty",
    "extraBody",
    "pricing",
  ] as const) {
    delete base[k];
  }

  return {
    ...base,
    models: [entry],
    defaultModel: modelId,
  };
}

/** 迁移整个 presets 数组；过滤无法迁移的脏数据 */
export function migratePresetsToNested(rawList: unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const item of rawList) {
    const m = migratePresetToNested(item);
    if (m) out.push(m);
  }
  return out;
}
