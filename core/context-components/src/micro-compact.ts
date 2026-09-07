/**
 * 轮次微压缩：不靠 LLM，按「这条内容出生后再过了几轮」瘦身。
 * 不按窗口涨了多少 token。
 */

import { pruneTextHeadTail, pruneToolResultText } from "./prune-text.js";
import { formatRetentionNotice, spillRetrieveHint, TOOL_RESULT_OMIT_MARKER } from "./omission.js";
import {
  foldSeqRanges,
  isFoldArtifact,
  segmentVisibleText,
  seqCoveredByFolds,
  type MaouMessage,
  type MaouTextSegment,
  type MaouTextSegmentAnnotations,
  type MaouTextSegmentAttributes,
  type MicroCompactableSegment,
} from "./types/message.js";

export type MicroCompactStrategy =
  | "head_tail"
  | "few_chars"
  | "empty"
  | "head_only"
  | "tail_only"
  | "first_line"
  | "notice"
  | "traditional_read"
  | "terminal_spill";

export interface MicroCompactPolicy {
  enabled: boolean;
  /** 写入时记下的 Agent 级轮次 */
  limitRounds: number;
  strategy: MicroCompactStrategy;
  keepChars?: number;
  /** traditional_read：文件少于此字数不压 */
  minChars?: number;
  /** 再读豁免：闸门跳过这一段 */
  exempt?: boolean;
}

export type MicroCompactCatalog = Record<string, MicroCompactPolicy | keyof typeof MICRO_COMPACT_PRESETS>;

export const TRADITIONAL_READ_MIN_CHARS = 500;
export const DEFAULT_MICRO_COMPACT_ROUNDS = 3;
export const TRADITIONAL_READ_REREAD_HINT =
  "本轮再次阅读下列文件，将返回全文且不再微压。";

export interface MicroUnlockItem {
  path?: string;
  omittedChars?: number;
}

/** 下一轮动态尾前缀。不写进已冻结的压缩件。 */
export function formatMicroUnlockPrefix(items: readonly MicroUnlockItem[]): string {
  if (items.length === 0) return "";
  const lines = items.map((item) => {
    const name = item.path?.trim() || "阅读结果";
    return typeof item.omittedChars === "number"
      ? `- ${name}（省略 ${item.omittedChars} 字）`
      : `- ${name}`;
  });
  return `[已微压缩 · ${TRADITIONAL_READ_REREAD_HINT}]\n${lines.join("\n")}`;
}

/** Agent 级微压缩轮次。非法或缺省 → 3。 */
export function resolveMicroCompactRounds(raw?: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return DEFAULT_MICRO_COMPACT_ROUNDS;
}

export const MICRO_COMPACT_PRESETS: Record<string, MicroCompactPolicy> = {
  head_tail: { enabled: true, limitRounds: 3, strategy: "head_tail" },
  few_chars: { enabled: true, limitRounds: 3, strategy: "few_chars", keepChars: 80 },
  empty: { enabled: true, limitRounds: 3, strategy: "empty" },
  head_only: { enabled: true, limitRounds: 3, strategy: "head_only", keepChars: 256 },
  tail_only: { enabled: true, limitRounds: 3, strategy: "tail_only", keepChars: 256 },
  first_line: { enabled: true, limitRounds: 3, strategy: "first_line" },
  notice: { enabled: true, limitRounds: 3, strategy: "notice" },
  traditional_read: {
    enabled: true,
    limitRounds: 3,
    strategy: "traditional_read",
    minChars: TRADITIONAL_READ_MIN_CHARS,
    keepChars: 200,
  },
  terminal_spill: {
    enabled: true,
    limitRounds: 3,
    strategy: "terminal_spill",
  },
};

/** 传统方案：reader / read / read_file 走字数门槛 + 再读豁免，不挂通用 head_tail。 */
export const DEFAULT_MICRO_COMPACT_CATALOG: MicroCompactCatalog = {
  reader: "traditional_read",
  read: "traditional_read",
  read_file: "traditional_read",
  use_terminal: "terminal_spill",
  bash: "terminal_spill",
  terminal_manage: "terminal_spill",
};

export function normalizeReadPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

export function extractSegmentPath(seg: MaouTextSegment): string {
  if (typeof seg.attributes?.path === "string" && seg.attributes.path.trim()) {
    return normalizeReadPath(seg.attributes.path);
  }
  const hit = seg.text.match(/\[(?:path|url)=([^\]|\s]+)/i);
  return hit?.[1] ? normalizeReadPath(hit[1]) : "";
}

export function extractSegmentCharCount(seg: MaouTextSegment): number {
  if (typeof seg.attributes?.totalChars === "number" && Number.isFinite(seg.attributes.totalChars)) {
    return seg.attributes.totalChars;
  }
  const tagged = seg.text.match(/total_chars=(\d+)/i) ?? seg.text.match(/(?:^|[|\s])chars=(\d+)/i);
  if (tagged) return Number(tagged[1]);
  return [...seg.text].length;
}

export function extractReadPath(m: MaouMessage): string {
  for (const seg of m.contents) {
    const path = extractSegmentPath(seg);
    if (path) return path;
  }
  if (typeof m.readPath === "string" && m.readPath.trim()) {
    return normalizeReadPath(m.readPath);
  }
  const meta = m.metadata;
  const fromMeta = meta?.path ?? meta?.file_path ?? meta?.url;
  if (typeof fromMeta === "string" && fromMeta.trim()) {
    return normalizeReadPath(fromMeta);
  }
  const text = m.contents.map((c) => c.text).join("\n");
  const hit = text.match(/\[(?:path|url)=([^\]|\s]+)/i);
  return hit?.[1] ? normalizeReadPath(hit[1]) : "";
}

export function extractReadCharCount(m: MaouMessage): number {
  for (const seg of m.contents) {
    if (typeof seg.attributes?.totalChars === "number") return seg.attributes.totalChars;
  }
  const text = m.contents.map((c) => c.text).join("\n");
  const tagged = text.match(/total_chars=(\d+)/i) ?? text.match(/(?:^|[|\s])chars=(\d+)/i);
  if (tagged) return Number(tagged[1]);
  return [...text].length;
}

function messagePaths(m: MaouMessage): string[] {
  const paths = m.contents.map(extractSegmentPath).filter(Boolean);
  const fallback = extractReadPath(m);
  if (fallback && !paths.includes(fallback)) paths.push(fallback);
  return paths;
}

function isRereadOf(history: readonly MaouMessage[], message: MaouMessage, path: string): boolean {
  if (!path) return false;
  const idx = history.indexOf(message);
  const prior =
    idx >= 0 ? history.slice(0, idx) : history.filter((other) => other.seqId < message.seqId);
  return prior.some((other) => messagePaths(other).includes(path));
}

export function segmentMicroMark(
  seg: MaouTextSegment,
): MicroCompactPolicy | MicroCompactStrategy | undefined {
  return seg.annotations?.microCompact;
}

export function segmentMicroPolicy(seg: MaouTextSegment): MicroCompactPolicy | undefined {
  return resolveMicroCompactPolicy(seg.annotations?.microCompact);
}

export function isMicroCompactableSegment(seg: MaouTextSegment): seg is MicroCompactableSegment {
  return segmentMicroMark(seg) != null;
}

export function textSegment(
  text: string,
  opts?: {
    strategy?: MicroCompactPolicy | MicroCompactStrategy;
    attributes?: MaouTextSegmentAttributes;
    annotations?: MaouTextSegmentAnnotations;
  },
): MaouTextSegment {
  const annotations: MaouTextSegmentAnnotations = { ...opts?.annotations };
  if (opts?.strategy !== undefined) annotations.microCompact = opts.strategy;
  const hasAnno = annotations.microCompact !== undefined;
  return {
    text,
    ...(opts?.attributes ? { attributes: opts.attributes } : {}),
    ...(hasAnno ? { annotations } : {}),
  };
}

function withSegmentMark(
  seg: MaouTextSegment,
  mark: MicroCompactPolicy | MicroCompactStrategy,
): MaouTextSegment {
  return {
    ...seg,
    annotations: { ...seg.annotations, microCompact: mark },
  };
}

export function resolveMicroCompactPolicy(
  spec: MicroCompactPolicy | keyof typeof MICRO_COMPACT_PRESETS | undefined,
): MicroCompactPolicy | undefined {
  if (!spec) return undefined;
  if (typeof spec === "string") return MICRO_COMPACT_PRESETS[spec];
  return spec;
}

export function normalizeToolName(name: string | undefined | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function policyForTool(
  toolName: string | undefined | null,
  catalog: MicroCompactCatalog = DEFAULT_MICRO_COMPACT_CATALOG,
): MicroCompactPolicy | undefined {
  const key = normalizeToolName(toolName);
  if (!key) return undefined;
  return resolveMicroCompactPolicy(catalog[key]);
}

export function toolNameOf(m: MaouMessage): string {
  if (typeof m.toolName === "string" && m.toolName.trim()) return m.toolName;
  const metaName = m.metadata && typeof m.metadata.tool_name === "string" ? m.metadata.tool_name : "";
  if (metaName) return metaName;
  return typeof m.source === "string" ? m.source : "";
}

export interface MicroCacheHold {
  currentTurn?: number;
  catalog?: MicroCompactCatalog;
  /** Agent 级微压缩轮次；所有微压功能共用 */
  limitRounds?: number;
}

/** Agent 级动态窗口宽度（轮次数）。 */
export function catalogDynamicWindow(
  _catalog?: MicroCompactCatalog,
  limitRounds?: number,
): number {
  return resolveMicroCompactRounds(limitRounds);
}

/** 已出动态轮：API 可见内容按缓存前缀，不再改。 */
export function holdAsPromptCache(m: MaouMessage, hold?: MicroCacheHold): boolean {
  if (m.microFrozen) return true;
  const currentTurn = hold?.currentTurn;
  if (typeof currentTurn !== "number" || !Number.isFinite(currentTurn) || currentTurn <= 0) {
    return false;
  }
  const born = m.microBornTurn;
  if (typeof born !== "number" || !Number.isFinite(born)) return false;
  return currentTurn - born >= resolveMicroCompactRounds(hold?.limitRounds);
}

function llmFacingEqual(a: MaouMessage, b: MaouMessage): boolean {
  if (a.category !== b.category || a.originalRole !== b.originalRole) return false;
  if (a.toolCallId !== b.toolCallId) return false;
  if ((a.reasoningContent ?? "") !== (b.reasoningContent ?? "")) return false;
  if (JSON.stringify(a.toolCalls ?? null) !== JSON.stringify(b.toolCalls ?? null)) return false;
  if (a.contents.length !== b.contents.length) return false;
  return a.contents.every((c, i) => segmentVisibleText(c) === segmentVisibleText(b.contents[i]!));
}

/** 还原被改写或丢掉的冻结前缀，只让动态尾变化留下来。折叠/归档盖住的区间不还原。 */
export function keepFrozenPrefix(
  before: MaouMessage[],
  after: MaouMessage[],
  hold?: MicroCacheHold,
): MaouMessage[] {
  const held = new Map<number, MaouMessage>();
  for (const m of before) {
    if (holdAsPromptCache(m, hold)) held.set(m.seqId, m);
  }
  if (held.size === 0) return after;

  const ranges = foldSeqRanges(after);
  const seen = new Set<number>();
  const next: MaouMessage[] = [];
  for (const m of after) {
    if (isFoldArtifact(m)) {
      next.push(m);
      const r = m.compact?.seqRange;
      if (r) {
        for (let s = r.start; s <= r.end; s++) seen.add(s);
      }
      seen.add(m.seqId);
      continue;
    }
    const orig = held.get(m.seqId);
    if (orig && !seqCoveredByFolds(m.seqId, ranges)) {
      next.push(llmFacingEqual(orig, m) ? m : orig);
      seen.add(m.seqId);
      continue;
    }
    next.push(m);
    seen.add(m.seqId);
  }
  for (const [seq, orig] of held) {
    if (seen.has(seq) || seqCoveredByFolds(seq, ranges)) continue;
    const idx = next.findIndex((x) => x.seqId > seq);
    if (idx < 0) next.push(orig);
    else next.splice(idx, 0, orig);
  }
  return next;
}

export function stampMicroBirth(
  message: MaouMessage,
  currentTurn: number,
  catalog: MicroCompactCatalog = DEFAULT_MICRO_COMPACT_CATALOG,
  history: readonly MaouMessage[] = [],
  limitRounds?: number,
): MaouMessage {
  if (message.microFrozen) return message;
  const next = message;
  if (next.microBornTurn == null && currentTurn > 0) {
    next.microBornTurn = currentTurn;
  }
  const fallback = policyForTool(toolNameOf(next), catalog);
  const stamped = resolveMicroCompactRounds(limitRounds);
  const catalogMark = fallback?.enabled
    ? { ...fallback, limitRounds: stamped }
    : undefined;
  let anyExempt = false;
  next.contents = next.contents.map((seg) => {
    const path = extractSegmentPath(seg);
    const totalChars = extractSegmentCharCount(seg);
    const attributes: MaouTextSegmentAttributes = {
      ...seg.attributes,
      ...(path && !seg.attributes?.path ? { path } : {}),
      ...(seg.attributes?.totalChars == null && totalChars > 0 ? { totalChars } : {}),
    };
    let out: MaouTextSegment = {
      ...seg,
      ...(path || attributes.totalChars != null ? { attributes } : {}),
    };
    if (segmentMicroMark(out) == null && catalogMark) {
      out = withSegmentMark(out, catalogMark);
    }
    const markPath = extractSegmentPath(out);
    if (markPath && isRereadOf(history, next, markPath)) {
      anyExempt = true;
      const policy = segmentMicroPolicy(out) ?? catalogMark;
      if (policy) out = withSegmentMark(out, { ...policy, exempt: true });
    }
    return out;
  });
  const path = extractReadPath(next);
  if (path) next.readPath = path;
  if (anyExempt) next.microExempt = true;
  return next;
}

export function renderMicroCompactText(text: string, policy: MicroCompactPolicy): string | null {
  const chars = [...text];
  if (chars.length === 0) return null;
  const keep = Math.max(1, policy.keepChars ?? 80);
  switch (policy.strategy) {
    case "empty":
      return TOOL_RESULT_OMIT_MARKER;
    case "notice":
      return `[已微压缩 · 原 ${chars.length} 字]`;
    case "few_chars": {
      if (chars.length <= keep) return null;
      return `${chars.slice(0, keep).join("")}…`;
    }
    case "head_only": {
      if (chars.length <= keep) return null;
      return pruneTextHeadTail(text, keep, 0) ?? `${chars.slice(0, keep).join("")}…`;
    }
    case "tail_only": {
      if (chars.length <= keep) return null;
      return pruneTextHeadTail(text, 0, keep) ?? `…${chars.slice(-keep).join("")}`;
    }
    case "first_line": {
      const line = text.split(/\r?\n/, 1)[0] ?? "";
      if (!line || line === text) return chars.length > keep ? `${chars.slice(0, keep).join("")}…` : null;
      return line.length < text.length ? `${line}…` : null;
    }
    case "traditional_read": {
      const min = policy.minChars ?? TRADITIONAL_READ_MIN_CHARS;
      if (chars.length < min) return null;
      const tail = Math.max(40, Math.floor(keep / 2));
      const omitted = Math.max(0, chars.length - keep - tail);
      const marker = `\n\n[已微压缩 · 省略 ${omitted} 字]\n\n`;
      return pruneTextHeadTail(text, keep, tail, marker);
    }
    case "terminal_spill": {
      const path =
        text.match(/\[(?:path|url)=([^\]|\s]+)/i)?.[1] ??
        text.match(/Full output stored at:\s+(\S+)/)?.[1];
      if (!path) return null;
      const lines = Number(text.match(/total_lines=(\d+)/i)?.[1]);
      const omitted =
        Number.isFinite(lines) && lines > 0
          ? { kind: "exact" as const, count: lines, unit: "lines" as const }
          : { kind: "unknown" as const, unit: "lines" as const };
      return formatRetentionNotice(omitted, {
        locator: path,
        retrieveHint: spillRetrieveHint({ unit: "lines" }),
      });
    }
    case "head_tail":
    default: {
      const pruned = pruneToolResultText(text);
      if (pruned && pruned !== text) return pruned;
      if (chars.length <= keep * 2) return null;
      return pruneTextHeadTail(text, keep, Math.floor(keep / 2)) ?? `${chars.slice(0, keep).join("")}…`;
    }
  }
}

export function applyRoundMicroCompact(
  history: MaouMessage[],
  currentTurn: number,
  _catalog: MicroCompactCatalog = DEFAULT_MICRO_COMPACT_CATALOG,
  limitRounds?: number,
): { history: MaouMessage[]; changed: boolean; unlockItems: MicroUnlockItem[] } {
  const exitAt = resolveMicroCompactRounds(limitRounds);
  let changed = false;
  const unlockItems: MicroUnlockItem[] = [];
  const next = history.map((m) => {
    if (m.microFrozen) return m;
    const born = m.microBornTurn;
    if (typeof born !== "number" || !Number.isFinite(born)) return m;
    if (currentTurn - born < exitAt) return m;

    let out: MaouMessage = m;
    const path = extractReadPath(m);
    if (path) out = { ...out, readPath: path };
    if (path && isRereadOf(history, m, path)) out = { ...out, microExempt: true };

    const contents = out.contents.map((seg) => {
      const policy = segmentMicroPolicy(seg);
      if (!policy?.enabled || policy.exempt) return seg;
      if (
        seg.microCompact?.enabled &&
        seg.microCompact.summary &&
        policy.strategy !== "terminal_spill"
      ) {
        return seg;
      }
      if (out.pinned || out.keepAfterCompress) return seg;
      const segPath = extractSegmentPath(seg);
      if (segPath && isRereadOf(history, m, segPath)) {
        return withSegmentMark(seg, { ...policy, exempt: true });
      }
      if (
        policy.strategy === "traditional_read" &&
        extractSegmentCharCount(seg) < (policy.minChars ?? TRADITIONAL_READ_MIN_CHARS)
      ) {
        return seg;
      }
      const summary = renderMicroCompactText(seg.text, { ...policy, limitRounds: exitAt });
      if (!summary || summary === seg.text) return seg;
      if (policy.strategy === "traditional_read") {
        const omitted = summary.match(/省略\s*(\d+)\s*字/);
        unlockItems.push({
          path: extractSegmentPath(seg) || extractReadPath(out) || undefined,
          omittedChars: omitted ? Number(omitted[1]) : undefined,
        });
      }
      return {
        ...seg,
        annotations: { ...seg.annotations, microCompact: { ...policy, limitRounds: exitAt } },
        microCompact: { enabled: true, summary },
      };
    });
    changed = true;
    return { ...out, contents, microFrozen: true };
  });
  return { history: next, changed, unlockItems };
}
