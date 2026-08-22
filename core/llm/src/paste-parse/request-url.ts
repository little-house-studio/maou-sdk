/**
 * 请求链接 + 协议。
 * 链接能明确协议就用链接；否则认文里的关键词；再不行才是 cc。
 */

import { normalizeApiProtocol, type APIProtocol } from "../adapters/types.js";
import type { SpanHit } from "./types.js";

export const DEFAULT_PROTOCOL: APIProtocol = "openai";

const LABEL =
  /(?:base[_ -]?url|endpoint|api[_ -]?url|接口(?:地址)?|请求(?:地址|链接)|网址|链接|url)\s*[:：=]?\s*$/i;

const BARE_HOST =
  /(?:base[_ -]?url|endpoint|api[_ -]?url|接口(?:地址)?|请求(?:地址|链接))\s*[:：=]\s*((?:https?:\/\/)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d{2,5})?(?:\/[^\s<>"'`，,;；]*)?)/gi;

const HREF = /https?:\/\/[^\s<>"'`]+/gi;

const PROTO_ASSIGN =
  /(?:protocol|协议|api\s*protocol|api[_-]?backend|backend)\s*[=:：]\s*["']?([A-Za-z0-9_-]+|cc|openai兼容|兼容)/gi;

const PROTO_PATHS: Array<{ re: RegExp; protocol: APIProtocol }> = [
  { re: /\/v1\/responses\b/i, protocol: "responses" },
  { re: /\/v1\/messages\b/i, protocol: "anthropic" },
  { re: /\/v1\/chat\/completions\b/i, protocol: "openai" },
];

const PROTO_WORDS: Array<{ re: RegExp; protocol: APIProtocol }> = [
  { re: /\b(?:openai-responses|openai_responses)\b/i, protocol: "responses" },
  { re: /\bresponses\b/i, protocol: "responses" },
  { re: /\banthropic\b/i, protocol: "anthropic" },
  { re: /\b(?:chat[_-]?completions)\b/i, protocol: "openai" },
  { re: /\b(?:gemini|google-vertex|vertex-ai)\b/i, protocol: "google" },
];

function cleanUrl(raw: string): string {
  let u = raw.trim().replace(/[)\]}>，,;；。'"\s]+$/g, "");
  if (u.startsWith("//")) u = `https:${u}`;
  return u;
}

function labeledAt(text: string, start: number): boolean {
  return LABEL.test(text.slice(Math.max(0, start - 28), start));
}

export function looksLikeApiUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    /\/v\d|\/chat|\/messages|\/responses|\/api|\/compatible|\/openai|\/completions|\/models|\/paas/i.test(u) ||
    /(?:^|\/\/)(?:[\w-]+\.)?api[.-]/i.test(u) ||
    /localhost|127\.0\.0\.1/i.test(u)
  );
}

/** 链接本身是否带得清协议（泛 /v1 不算明确）。 */
export function guessProtocolFromUrl(url: string): APIProtocol | undefined {
  const u = url.toLowerCase();
  if (/openai\.azure\.com|\/openai\/deployments\//.test(u)) return "azure";
  if (/\/v1\/messages\b|api\.anthropic\.com/.test(u) && !/openrouter/.test(u)) return "anthropic";
  if (/\/v1\/responses\b|\/responses$/.test(u)) return "responses";
  if (/generativelanguage\.googleapis|\/v1beta\/models/.test(u)) return "google";
  if (/aiplatform\.googleapis|\bvertex\b/.test(u)) return "google-vertex";
  if (/bedrock-runtime|\/model\/.+\/converse/.test(u)) return "bedrock";
  if (/api\.mistral\.ai/.test(u)) return "mistral";
  if (/githubcopilot\.com|api\.githubcopilot/.test(u)) return "github-copilot";
  return undefined;
}

/** 从 URL 路径/主机推断协议；看不出则 cc。 */
export function inferProtocolFromUrl(url: string): APIProtocol {
  return guessProtocolFromUrl(url) ?? DEFAULT_PROTOCOL;
}

export function normalizePastedProtocol(raw: string): APIProtocol {
  const s = raw.trim().toLowerCase();
  if (s === "cc" || s === "openai兼容" || s === "兼容" || s === "chat-completions" || s === "chat_completions") {
    return DEFAULT_PROTOCOL;
  }
  if (s === "messages") return "anthropic";
  return normalizeApiProtocol(s);
}

export function extractRequestUrls(text: string): SpanHit[] {
  const hits: SpanHit[] = [];
  const seen = new Set<string>();

  const push = (raw: string, start: number, extractor: "url" | "base_url") => {
    const value = cleanUrl(raw);
    if (!value) return;
    if (!/^https?:\/\//i.test(value) && !/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value)) return;
    const filled = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    if (seen.has(filled)) return;
    seen.add(filled);
    const api = looksLikeApiUrl(filled);
    hits.push({
      value: filled,
      start,
      end: start + raw.length,
      extractor,
      labeled: labeledAt(text, start),
      confidence: labeledAt(text, start) ? 0.95 : api ? 0.92 : 0.72,
    });
  };

  for (const m of text.matchAll(new RegExp(HREF.source, "gi"))) {
    if (m.index == null) continue;
    push(m[0]!, m.index, "base_url");
  }
  for (const m of text.matchAll(new RegExp(BARE_HOST.source, "gi"))) {
    if (m.index == null || !m[1]) continue;
    const start = m.index + m[0]!.lastIndexOf(m[1]);
    push(m[1], start, "base_url");
  }

  const apiHits = hits.filter((h) => looksLikeApiUrl(h.value));
  const picked = apiHits.length ? apiHits : hits;
  for (const h of picked) {
    if (!/\/models\/?$/i.test(h.value)) continue;
    const base = h.value.replace(/\/models\/?$/i, "");
    if (picked.some((o) => o.value.replace(/\/+$/, "") === base.replace(/\/+$/, ""))) {
      h.confidence = Math.min(h.confidence, 0.8);
    }
  }
  return picked;
}

function protocolHit(
  value: string,
  start: number,
  end: number,
  labeled: boolean,
  confidence: number,
): SpanHit {
  return { value, start, end, extractor: "protocol", labeled, confidence };
}

export function extractProtocol(text: string): SpanHit[] {
  const assigned: SpanHit[] = [];
  for (const m of text.matchAll(new RegExp(PROTO_ASSIGN.source, "gi"))) {
    if (m.index == null || !m[1]) continue;
    const raw = m[1].trim();
    const value = normalizePastedProtocol(raw);
    const start = m.index + m[0]!.lastIndexOf(m[1]);
    assigned.push(protocolHit(value, start, endOf(start, raw), true, 0.95));
  }
  if (assigned.length) return pickProtocolMode(assigned);

  const urls = extractRequestUrls(text);
  const explicit = urls
    .map((u) => {
      const proto = guessProtocolFromUrl(u.value);
      return proto
        ? protocolHit(proto, u.start, u.end, false, 0.9)
        : undefined;
    })
    .filter((h): h is SpanHit => Boolean(h));
  if (explicit.length) return pickProtocolMode(explicit);

  const paths: SpanHit[] = [];
  for (const { re, protocol } of PROTO_PATHS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      if (m.index == null) continue;
      paths.push(protocolHit(protocol, m.index, m.index + m[0].length, false, 0.9));
    }
  }
  if (paths.length) return pickProtocolMode(paths);

  const words: SpanHit[] = [];
  for (const { re, protocol } of PROTO_WORDS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      if (m.index == null) continue;
      words.push(protocolHit(protocol, m.index, m.index + m[0].length, false, 0.86));
    }
  }
  if (words.length) return pickProtocolMode(words);

  return [];
}

function endOf(start: number, raw: string): number {
  return start + raw.length;
}

function pickProtocolMode(hits: SpanHit[]): SpanHit[] {
  const counts = new Map<string, { n: number; hit: SpanHit }>();
  for (const h of hits) {
    const cur = counts.get(h.value);
    if (!cur) counts.set(h.value, { n: 1, hit: h });
    else cur.n += 1;
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n || b.hit.confidence - a.hit.confidence)[0];
  return best ? [best.hit] : hits.slice(0, 1);
}
