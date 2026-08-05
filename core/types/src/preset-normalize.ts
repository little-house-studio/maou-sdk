/**
 * 运行时 preset 字段规范化（全产品唯一实现）。
 *
 * 输入：expand 后的扁平 preset（或任意近似形状）。
 * 保证：
 * - reasoning_params / reasoningParams 双写（adapter 读 snake，schema/UI 用 camel）
 * - pricing 嵌套 + 扁平 inputPrice / input_price 对齐
 * - 采样 fold 进 extraBody（adapter 常只读 body）
 * - maxConcurrent / max_concurrent 双写
 * - supportsAudio / supportsVideo 从 snake 提升
 *
 * 不在此处理：models[] expand（见 preset-models）、roles 解析（见 api-roles）。
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asFiniteNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 规范化单个运行时 preset，返回新对象（不改入参）。
 */
export function normalizeRuntimePreset(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const p: Record<string, unknown> = { ...raw };

  // ── reasoning 双写 ──
  const reasoning =
    (isPlainObject(p.reasoningParams) ? p.reasoningParams : undefined) ??
    (isPlainObject(p.reasoning_params) ? p.reasoning_params : undefined);
  if (reasoning) {
    p.reasoningParams = reasoning;
    p.reasoning_params = reasoning;
  }

  // ── pricing：嵌套 + 扁平 ──
  const nested = isPlainObject(p.pricing) ? p.pricing : undefined;
  const inputPrice =
    asFiniteNumber(nested?.inputPrice) ??
    asFiniteNumber(nested?.input) ??
    asFiniteNumber(p.inputPrice) ??
    asFiniteNumber(p.input_price);
  const outputPrice =
    asFiniteNumber(nested?.outputPrice) ??
    asFiniteNumber(nested?.output) ??
    asFiniteNumber(p.outputPrice) ??
    asFiniteNumber(p.output_price);
  const cacheHitPrice =
    asFiniteNumber(nested?.cacheHitPrice) ??
    asFiniteNumber(nested?.cacheRead) ??
    asFiniteNumber(p.cacheHitPrice) ??
    asFiniteNumber(p.cache_hit_price);

  if (inputPrice !== undefined || outputPrice !== undefined) {
    p.pricing = {
      ...(nested ?? {}),
      inputPrice: inputPrice ?? 0,
      outputPrice: outputPrice ?? 0,
      ...(cacheHitPrice !== undefined ? { cacheHitPrice } : {}),
      currency:
        typeof nested?.currency === "string"
          ? nested.currency
          : typeof p.currency === "string"
            ? p.currency
            : "USD",
    };
    p.inputPrice = inputPrice ?? 0;
    p.outputPrice = outputPrice ?? 0;
    p.input_price = inputPrice ?? 0;
    p.output_price = outputPrice ?? 0;
    if (cacheHitPrice !== undefined) {
      p.cacheHitPrice = cacheHitPrice;
      p.cache_hit_price = cacheHitPrice;
    }
  }

  // ── concurrency 双写 ──
  const maxConcurrent =
    asFiniteNumber(p.maxConcurrent) ?? asFiniteNumber(p.max_concurrent);
  if (maxConcurrent !== undefined && maxConcurrent > 0) {
    const n = Math.floor(maxConcurrent);
    p.maxConcurrent = n;
    p.max_concurrent = n;
  }

  // ── 采样 → extraBody ──
  const temperature = asFiniteNumber(p.temperature);
  const topP = asFiniteNumber(p.topP) ?? asFiniteNumber(p.top_p);
  const presencePenalty =
    asFiniteNumber(p.presencePenalty) ?? asFiniteNumber(p.presence_penalty);
  const frequencyPenalty =
    asFiniteNumber(p.frequencyPenalty) ?? asFiniteNumber(p.frequency_penalty);

  let extraBody: Record<string, unknown> = {};
  if (isPlainObject(p.extraBody)) {
    extraBody = { ...p.extraBody };
  }
  // normalizeKeys 可能把 body 内 top_p → topP；请求体需要 snake_case
  const camelToSnakeBody: Record<string, string> = {
    topP: "top_p",
    presencePenalty: "presence_penalty",
    frequencyPenalty: "frequency_penalty",
  };
  for (const [camel, snake] of Object.entries(camelToSnakeBody)) {
    if (extraBody[camel] !== undefined && extraBody[snake] === undefined) {
      extraBody[snake] = extraBody[camel];
      delete extraBody[camel];
    }
  }
  if (temperature !== undefined && extraBody.temperature === undefined) {
    extraBody.temperature = temperature;
    p.temperature = temperature;
  }
  if (topP !== undefined && extraBody.top_p === undefined) {
    extraBody.top_p = topP;
    p.top_p = topP;
    p.topP = topP;
  }
  if (presencePenalty !== undefined && extraBody.presence_penalty === undefined) {
    extraBody.presence_penalty = presencePenalty;
    p.presence_penalty = presencePenalty;
    p.presencePenalty = presencePenalty;
  }
  if (frequencyPenalty !== undefined && extraBody.frequency_penalty === undefined) {
    extraBody.frequency_penalty = frequencyPenalty;
    p.frequency_penalty = frequencyPenalty;
    p.frequencyPenalty = frequencyPenalty;
  }
  if (Object.keys(extraBody).length > 0) {
    p.extraBody = extraBody;
  }

  // ── 能力位 snake → camel ──
  if (p.supportsAudio === undefined && p.supports_audio !== undefined) {
    p.supportsAudio = Boolean(p.supports_audio);
  }
  if (p.supportsVideo === undefined && p.supports_video !== undefined) {
    p.supportsVideo = Boolean(p.supports_video);
  }
  if (p.supportsVision === undefined && p.supports_vision !== undefined) {
    p.supportsVision = Boolean(p.supports_vision);
  }
  if (p.supportsReasoning === undefined && p.supports_reasoning !== undefined) {
    p.supportsReasoning = Boolean(p.supports_reasoning);
  }

  return p;
}

/** @deprecated 用 normalizeRuntimePreset；保留别名供 ConfigStore / 旧 import */
export const normalizeLoadedPreset = normalizeRuntimePreset;
