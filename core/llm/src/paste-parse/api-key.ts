/**
 * 粘贴文本里抽 API Key：一条扫描规则。
 *
 * 连续：字母 / 数字 / `-` / `_`
 * 截断：除此之外的任何字符（空白、标点、中文、`:`、`.`、`/`…）
 * 命中：连续段长度 > 16，且不像已经能被其它规则吃掉的字段。
 *
 * 选型：sk 开头优先；否则取「: / ： 后面」或双引号包围的合格段；
 * 再没有就用全场最长合格段。
 */

import type { SpanHit } from "./types.js";

export const API_KEY_MIN = 16;

const CONT = /[A-Za-z0-9_-]/;

const LABEL_NEAR =
  /(?:api[_ -]?key|secret[_ -]?key|密钥|token|bearer|authorization|auth)\s*[:：=]?\s*$/i;

function labeledAt(text: string, start: number): boolean {
  return LABEL_NEAR.test(text.slice(Math.max(0, start - 28), start));
}

function insideUrl(text: string, start: number): boolean {
  return /https?:\/\/[^\s]*$/i.test(text.slice(0, start));
}

/** 已被手机号 / 身份证等规则认走的，不当 key。 */
function reservedToken(value: string): boolean {
  if (/^1[3-9]\d{9}$/.test(value)) return true;
  if (/^[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(value)) {
    return true;
  }
  return false;
}

export function looksLikeApiKey(value: string): boolean {
  const v = value.trim();
  if (v.length <= API_KEY_MIN) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return false;
  if (reservedToken(v)) return false;
  return true;
}

function startsWithSk(value: string): boolean {
  return /^sk/i.test(value);
}

function quotedAt(text: string, start: number, end: number): boolean {
  const left = text[start - 1];
  const right = text[end];
  return (left === '"' && right === '"') || (left === "'" && right === "'");
}

function afterColon(text: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0 && /[\s"'`]/.test(text[i]!)) i -= 1;
  return i >= 0 && (text[i] === ":" || text[i] === "：");
}

function keyScore(text: string, start: number, end: number, value: string): number {
  if (startsWithSk(value)) return 1_000_000 + value.length;
  if (quotedAt(text, start, end) || afterColon(text, start)) return 100_000 + value.length;
  return value.length;
}

export function extractApiKeys(text: string): SpanHit[] {
  const hits: SpanHit[] = [];
  let i = 0;
  while (i < text.length) {
    if (!CONT.test(text[i]!)) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < text.length && CONT.test(text[i]!)) i += 1;
    const value = text.slice(start, i);
    if (!looksLikeApiKey(value)) continue;
    if (insideUrl(text, start)) continue;
    const marked = labeledAt(text, start) || quotedAt(text, start, i) || afterColon(text, start);
    hits.push({
      value,
      start,
      end: i,
      extractor: "api_key",
      labeled: marked,
      confidence: startsWithSk(value) ? 0.96 : marked ? 0.93 : 0.86,
    });
  }
  hits.sort((a, b) => {
    const d = keyScore(text, b.start, b.end, b.value) - keyScore(text, a.start, a.end, a.value);
    if (d !== 0) return d;
    return a.start - b.start;
  });
  return hits.map((h, idx) => (idx === 0 ? h : { ...h, confidence: Math.min(h.confidence, 0.45) }));
}
