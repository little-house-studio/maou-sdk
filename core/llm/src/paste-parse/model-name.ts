/**
 * 模型名：厂商 /v1/models（2s）+ models.dev 公开目录对名单，
 * 再不行才猜 5–18 位「字母多于数字」的连续段。
 */

import { getAllModels } from "../registry/index.js";
import type { SpanHit } from "./types.js";
import { looksLikeApiKey } from "./api-key.js";

export const MODEL_LIST_TIMEOUT_MS = 2_000;
export const MODEL_CATALOG_TIMEOUT_MS = 4_000;
export const MODEL_NAME_MIN = 5;
export const MODEL_NAME_MAX = 18;
export const MODELS_DEV_URL = "https://models.dev/api.json";

const CONT = /[A-Za-z0-9._:/-]/;
const LABEL_NEAR = /(?:model(?:[ _-]?id)?|模型)\s*[:：=]\s*["']?$/i;

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

function labeledAt(text: string, start: number): boolean {
  return LABEL_NEAR.test(text.slice(Math.max(0, start - 20), start));
}

function letterDigitCounts(value: string): { letters: number; digits: number } {
  let letters = 0;
  let digits = 0;
  for (const ch of value) {
    if (/[A-Za-z]/.test(ch)) letters += 1;
    else if (/\d/.test(ch)) digits += 1;
  }
  return { letters, digits };
}

/** 未标注：5–18，有字母有数字，字母数 > 数字数。 */
export function looksLikeModelName(value: string, labeled = false): boolean {
  const v = value.trim();
  if (!v) return false;
  if (labeled) {
    if (v.length < 2 || v.length > 64) return false;
    if (!/^[A-Za-z0-9._:/-]+$/.test(v)) return false;
    return !looksLikeApiKey(v);
  }
  if (v.length < MODEL_NAME_MIN || v.length > MODEL_NAME_MAX) return false;
  if (!/^[A-Za-z0-9._:/-]+$/.test(v)) return false;
  const { letters, digits } = letterDigitCounts(v);
  if (letters === 0 || digits === 0) return false;
  if (letters <= digits) return false;
  if (looksLikeApiKey(v)) return false;
  return true;
}

function overlaps(start: number, end: number, reserved: Array<{ start: number; end: number }>): boolean {
  return reserved.some((r) => start < r.end && end > r.start);
}

export function extractModelGuesses(
  text: string,
  reserved: Array<{ start: number; end: number }> = [],
): SpanHit[] {
  const hits: SpanHit[] = [];
  let i = 0;
  while (i < text.length) {
    if (!CONT.test(text[i]!)) {
      i += 1;
      continue;
    }
    const rawStart = i;
    while (i < text.length && CONT.test(text[i]!)) i += 1;
    let start = rawStart;
    let end = i;
    while (start < end && /[:/=.]/.test(text[start]!)) start += 1;
    while (end > start && /[:/=.]/.test(text[end - 1]!)) end -= 1;
    const value = text.slice(start, end);
    if (overlaps(start, end, reserved)) continue;
    const labeled = labeledAt(text, start);
    if (!looksLikeModelName(value, labeled)) continue;
    hits.push({
      value,
      start,
      end,
      extractor: "model",
      labeled,
      confidence: labeled ? 0.93 : 0.72,
    });
  }
  return hits;
}

function assignedIds(text: string, key: string): string[] {
  const re = new RegExp(
    `(?:^|[^A-Za-z0-9_])${key}\\s*[=:：]\\s*["']?([A-Za-z0-9._:/-]+)`,
    "gi",
  );
  return [...text.matchAll(re)].map((m) => m[1]!).filter(Boolean);
}

const SKIP_DECLARED =
  /^(limit|options|variants|name|id|type|model|models|provider|openai|anthropic|google|low|medium|high|xhigh|max|store|goals|features|agent|build|plan|default)$/i;

function looksLikeDeclaredModelId(id: string): boolean {
  const v = id.trim();
  if (v.length < 2 || v.length > 80) return false;
  if (!/^[A-Za-z0-9._:/-]+$/.test(v)) return false;
  if (SKIP_DECLARED.test(v)) return false;
  return /[0-9]/.test(v) || /[-_./]/.test(v);
}

function pushUnique(out: string[], seen: Set<string>, id: string): void {
  const v = id.trim();
  if (!looksLikeDeclaredModelId(v)) return;
  const k = v.toLowerCase();
  if (seen.has(k)) return;
  seen.add(k);
  out.push(v);
}

function sliceBalanced(text: string, open: number, openCh: "{" | "[", closeCh: "}" | "]"): string {
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open, Math.min(text.length, open + 50_000));
}

function pushQuotedIds(body: string, out: string[], seen: Set<string>): void {
  for (const m of body.matchAll(/["']([A-Za-z0-9._:/-]{2,64})["']/g)) {
    pushUnique(out, seen, m[1] || "");
  }
}

/** 配置结构里声明的模型：model=/default=、TOML [model."id"]、JSON models 对象或数组。 */
export function extractDeclaredModelIds(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const id of assignedIds(text, "model")) pushUnique(out, seen, id);
  for (const id of assignedIds(text, "default")) pushUnique(out, seen, id);
  for (const m of text.matchAll(/\[model\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9._:/-]+))\]/gi)) {
    pushUnique(out, seen, m[1] || m[2] || m[3] || "");
  }

  for (const objHit of text.matchAll(/"models"\s*:\s*\{/g)) {
    if (objHit.index == null) continue;
    const brace = text.indexOf("{", objHit.index);
    const body = sliceBalanced(text, brace, "{", "}");
    for (const m of body.matchAll(/"([A-Za-z0-9._:/-]{2,64})"\s*:\s*\{/g)) {
      pushUnique(out, seen, m[1] || "");
    }
  }

  for (const arrHit of text.matchAll(/(?:^|[^A-Za-z0-9_])models\s*[:=：]\s*\[/g)) {
    if (arrHit.index == null) continue;
    const bracket = text.indexOf("[", arrHit.index);
    pushQuotedIds(sliceBalanced(text, bracket, "[", "]"), out, seen);
  }
  return out;
}

function rankFound(
  text: string,
  found: Map<string, { id: string; start: number; end: number; count: number }>,
): Array<{ id: string; start: number; end: number; count: number }> {
  const defaults = new Set(assignedIds(text, "default").map((s) => s.toLowerCase()));
  const models = new Set(assignedIds(text, "model").map((s) => s.toLowerCase()));
  return [...found.values()].sort((a, b) => {
    const ad = defaults.has(a.id.toLowerCase()) ? 1 : 0;
    const bd = defaults.has(b.id.toLowerCase()) ? 1 : 0;
    if (ad !== bd) return bd - ad;
    const am = models.has(a.id.toLowerCase()) ? 1 : 0;
    const bm = models.has(b.id.toLowerCase()) ? 1 : 0;
    if (am !== bm) return bm - am;
    if (a.count !== b.count) return b.count - a.count;
    if (a.id.length !== b.id.length) return b.id.length - a.id.length;
    return a.start - b.start;
  });
}

export function matchAllModelsInText(text: string, ids: string[]): SpanHit[] {
  const byLower = new Map<string, string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (id.length < 2) continue;
    const k = id.toLowerCase();
    const prev = byLower.get(k);
    if (!prev || id.length > prev.length) byLower.set(k, id);
  }
  if (!byLower.size) return [];

  const found = new Map<string, { id: string; start: number; end: number; count: number }>();
  let i = 0;
  while (i < text.length) {
    if (!CONT.test(text[i]!)) {
      i += 1;
      continue;
    }
    const rawStart = i;
    while (i < text.length && CONT.test(text[i]!)) i += 1;
    let start = rawStart;
    let end = i;
    while (start < end && /[:/=.]/.test(text[start]!)) start += 1;
    while (end > start && /[:/=.]/.test(text[end - 1]!)) end -= 1;
    const token = text.slice(start, end);
    const id = byLower.get(token.toLowerCase());
    if (!id) continue;
    const cur = found.get(id);
    if (!cur) found.set(id, { id, start, end, count: 1 });
    else cur.count += 1;
  }
  if (!found.size) return [];

  return rankFound(text, found).map((best) => ({
    value: best.id,
    start: best.start,
    end: best.end,
    extractor: "model" as const,
    labeled: labeledAt(text, best.start),
    confidence: 0.95,
  }));
}

export function matchModelsInText(text: string, ids: string[]): SpanHit | undefined {
  return matchAllModelsInText(text, ids)[0];
}

/** 配置里声明的模型优先；没有结构时用目录里扫到的全部 id。 */
export function collectModelIds(text: string, catalogIds: string[]): string[] {
  const declared = extractDeclaredModelIds(text);
  if (declared.length) return declared;
  return matchAllModelsInText(text, catalogIds).map((h) => h.value);
}

export function pickPrimaryModel(text: string, ids: string[]): string | undefined {
  if (!ids.length) return undefined;
  const defaults = assignedIds(text, "default").map((s) => s.toLowerCase());
  for (const d of defaults) {
    const hit = ids.find((id) => id.toLowerCase() === d);
    if (hit) return hit;
  }
  return ids[0];
}

export function builtinCatalogModelIds(): string[] {
  return getAllModels().map((m) => m.id).filter((id) => id.length >= 2);
}

export function parseModelsDevIds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const ids: string[] = [];
  for (const p of Object.values(data as Record<string, unknown>)) {
    if (!p || typeof p !== "object") continue;
    const models = (p as { models?: Record<string, { id?: string }> }).models;
    if (!models || typeof models !== "object") continue;
    for (const [mid, m] of Object.entries(models)) {
      const id = m && typeof m === "object" && typeof m.id === "string" && m.id.trim() ? m.id.trim() : mid;
      if (id) ids.push(id);
    }
  }
  return ids;
}

function uniqIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length >= 2))];
}

/** 公开目录：models.dev（实时）+ 内置 catalog 兜底。自定义 fetch 不写缓存。 */
export async function fetchPublicCatalogIds(opts?: {
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<string[]> {
  const local = builtinCatalogModelIds();
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return local;
  const timeoutMs = opts?.timeoutMs ?? MODEL_CATALOG_TIMEOUT_MS;

  const ac = new AbortController();
  let settle: ((ids: string[]) => void) | undefined;
  const timeoutPromise = new Promise<string[]>((resolve) => {
    settle = resolve;
  });
  const timer = setTimeout(() => {
    ac.abort();
    settle?.([]);
  }, timeoutMs);

  try {
    const live = await Promise.race([
      (async () => {
        const res = await fetchImpl(MODELS_DEV_URL, { signal: ac.signal });
        if (!res.ok) return [] as string[];
        return parseModelsDevIds(await res.json());
      })(),
      timeoutPromise,
    ]);
    return uniqIds([...live, ...local]);
  } catch {
    return local;
  } finally {
    clearTimeout(timer);
  }
}

function stripApiBase(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  u = u.replace(/\/chat\/completions$/i, "");
  u = u.replace(/\/v1\/(messages|responses)$/i, "");
  u = u.replace(/\/v1$/i, "");
  return u.replace(/\/+$/, "");
}

function parseModelIds(data: Record<string, unknown>): string[] {
  const raw = data.data ?? data.models;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (typeof m === "string") return m.trim();
      if (m && typeof m === "object") {
        const o = m as Record<string, unknown>;
        return String(o.id ?? o.name ?? "").replace(/^models\//, "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

export async function fetchModelIds(opts: {
  url: string;
  key?: string;
  protocol?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<string[]> {
  const url = opts.url.trim();
  if (!url) return [];
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") return [];
  const timeoutMs = opts.timeoutMs ?? MODEL_LIST_TIMEOUT_MS;
  const proto = (opts.protocol ?? "openai").toLowerCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`;

  const ac = new AbortController();
  let settleTimeout: ((ids: string[]) => void) | undefined;
  const timeoutPromise = new Promise<string[]>((resolve) => {
    settleTimeout = resolve;
  });
  const timer = setTimeout(() => {
    ac.abort();
    settleTimeout?.([]);
  }, timeoutMs);

  const request = (async (): Promise<string[]> => {
    if (proto === "google" || proto === "google-vertex") {
      const base = url.replace(/\/models.*/, "") || "https://generativelanguage.googleapis.com/v1beta";
      const keyQ = proto === "google" && opts.key ? `?key=${encodeURIComponent(opts.key)}` : "";
      const res = await fetchImpl(`${base}/models${keyQ}`, {
        headers: proto === "google-vertex" ? headers : {},
        signal: ac.signal,
      });
      if (!res.ok) return [];
      return parseModelIds((await res.json()) as Record<string, unknown>);
    }

    const base = stripApiBase(url);
    const res = await fetchImpl(`${base}/v1/models`, { headers, signal: ac.signal });
    if (!res.ok) return [];
    return parseModelIds((await res.json()) as Record<string, unknown>);
  })();

  try {
    return await Promise.race([request, timeoutPromise]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
