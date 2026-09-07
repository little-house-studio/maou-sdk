/**
 * 大压缩折叠：未折叠的旧侧收成一条折叠卡（不新开 LLM）。
 * 折叠区占窗口过半时，再 LLM 总结并写出归档查表文件。
 */

import {
  FOLD_ARCHIVE_PERCENT,
  RETAIN_TAIL_RATIO,
  SUMMARY_TRIGGER_PERCENT,
} from "../constants.js";
import { extractSegmentPath } from "../micro-compact.js";
import {
  writeArchiveLookup,
  type ArchiveLookupEntry,
} from "../original-record.js";
import { estimateTokens } from "../token-estimate.js";
import { snapRetainStartForToolPairs } from "../tool-pairing.js";
import {
  isFoldArtifact,
  segmentVisibleText,
  seqRangeOf,
  type MaouMessage,
} from "../types/message.js";
import type { FoldStageConfig, FoldStep } from "./ports.js";

export type { FoldStageConfig };

export const DEFAULT_FOLD_STAGE: FoldStageConfig = {
  enabled: true,
  triggerPercent: SUMMARY_TRIGGER_PERCENT,
  archiveFoldedPercent: FOLD_ARCHIVE_PERCENT,
  retainTailRatio: RETAIN_TAIL_RATIO,
};

export function resolveFoldStage(partial?: Partial<FoldStageConfig> | false): FoldStageConfig {
  if (partial === false) return { ...DEFAULT_FOLD_STAGE, enabled: false };
  return { ...DEFAULT_FOLD_STAGE, ...partial };
}

export type FoldSummarizer = (input: {
  kind: "archive";
  messages: Array<{ role: string; content: string }>;
}) => Promise<string>;

export type CustomFoldFn = (input: {
  stage: "summary" | "archive";
  compressible: MaouMessage[];
  history: MaouMessage[];
}) => Promise<{ replacement: MaouMessage[]; droppedSummary: string } | null>;

export interface ApplyFoldStageInput {
  occupancy: number;
  window: number;
  config?: Partial<FoldStageConfig> | false;
  sessionRoot?: string;
  sessionId?: string;
  summarizer?: FoldSummarizer;
  customFold?: CustomFoldFn;
  retainCount?: number;
}

export interface ApplyFoldStageResult {
  history: MaouMessage[];
  changed: boolean;
  stage: "none" | "summary" | "archive";
  summary: string;
  archivePath?: string;
}

const STUB_CHARS = 160;

export function alreadyFolded(m: MaouMessage): boolean {
  const t = m.compact?.type;
  return t === "fold" || t === "archive" || t === "major" || t === "dead";
}

export function skipFoldKeep(m: MaouMessage): boolean {
  if (m.category === "system" || m.category === "baked") return true;
  if (m.pinned) return true;
  if (alreadyFolded(m)) return true;
  if (m.keepAfterCompress && !isFoldArtifact(m)) return true;
  return false;
}

export function retainStartOf(
  history: MaouMessage[],
  retainCount: number,
): number {
  if (history.length === 0) return 0;
  const keep = Math.min(history.length, Math.max(1, Math.trunc(retainCount)));
  return snapRetainStartForToolPairs(history, history.length - keep);
}

export function extractMessagePath(m: MaouMessage): string {
  if (typeof m.readPath === "string" && m.readPath.trim()) return m.readPath.trim();
  for (const seg of m.contents) {
    const p = extractSegmentPath(seg);
    if (p) return p;
  }
  const text = m.contents.map((c) => c.text).join("\n");
  const tagged = text.match(/\[(?:path|url)=([^\]|\s]+)/i)?.[1];
  if (tagged) return tagged;
  const stored = text.match(/Full output stored at:\s+(\S+)/)?.[1];
  return stored?.replace(/[.,;]+$/, "") ?? "";
}

export function messageStub(m: MaouMessage): string {
  const visible = m.contents.map(segmentVisibleText).join("\n").trim();
  const line = visible.split(/\r?\n/, 1)[0] ?? "";
  const short = [...line].slice(0, STUB_CHARS).join("");
  const path = extractMessagePath(m);
  const tool = m.toolName ? ` ${m.toolName}` : "";
  const loc = path ? ` path=${path}` : "";
  return `- [${m.category}${tool} #${m.seqId}]${loc} ${short}`;
}

export function renderFoldCard(msgs: MaouMessage[]): string {
  const range = seqRangeOf(msgs);
  const span = range ? `${range.start}-${range.end}` : "?";
  const lines = [
    `<folded-span seq="${span}">`,
    `此前 ${msgs.length} 条已折叠。需要原文时按 path 用 read，或查会话日志。`,
    ...msgs.map(messageStub),
    `</folded-span>`,
  ];
  return lines.join("\n");
}

export function makeFoldCard(msgs: MaouMessage[]): MaouMessage | null {
  if (msgs.length === 0) return null;
  const range = seqRangeOf(msgs);
  const summary = renderFoldCard(msgs);
  return {
    seqId: range?.start ?? msgs[0]!.seqId,
    taskIds: [],
    contents: [{ text: summary }],
    keepAfterCompress: true,
    category: "compact",
    originalRole: "user",
    compact: {
      type: "fold",
      summary,
      ...(range ? { seqRange: range } : {}),
    },
  };
}

export function foldedRegionMessages(history: MaouMessage[]): MaouMessage[] {
  return history.filter((m) => isFoldArtifact(m) || m.compact?.type === "major" || m.compact?.type === "dead");
}

export function foldedRegionShare(history: MaouMessage[], window: number): number {
  if (window <= 0) return 0;
  return estimateTokens(foldedRegionMessages(history)) / window;
}

function markFolded(replacement: MaouMessage[], originals: MaouMessage[]): MaouMessage[] {
  const range = seqRangeOf(originals);
  return replacement.map((m, i) => ({
    ...m,
    keepAfterCompress: true,
    compact: m.compact ?? {
      type: "fold" as const,
      summary: m.contents.map(segmentVisibleText).join("\n"),
      ...(range ? { seqRange: range } : {}),
    },
    seqId: m.seqId >= 0 ? m.seqId : (range?.start ?? i),
  }));
}

export function foldUnfoldedSpan(
  history: MaouMessage[],
  retainCount: number,
): { history: MaouMessage[]; changed: boolean; summary: string; folded: MaouMessage[] } {
  const start = retainStartOf(history, retainCount);
  const head = history.slice(0, start);
  const tail = history.slice(start);
  const toFold = head.filter((m) => !skipFoldKeep(m));
  const keptHead = head.filter((m) => skipFoldKeep(m));
  if (toFold.length === 0) {
    return { history, changed: false, summary: "", folded: [] };
  }
  const card = makeFoldCard(toFold);
  if (!card) return { history, changed: false, summary: "", folded: [] };
  const next = [...keptHead, card, ...tail].sort((a, b) => a.seqId - b.seqId);
  return { history: next, changed: true, summary: card.compact?.summary ?? "", folded: toFold };
}

function archiveEntries(msgs: MaouMessage[]): ArchiveLookupEntry[] {
  const entries: ArchiveLookupEntry[] = [];
  for (const m of msgs) {
    const path = extractMessagePath(m);
    entries.push({
      seq: m.seqId,
      category: m.category,
      stub: messageStub(m),
      ...(path ? { path } : {}),
    });
  }
  return entries;
}

function collectArchiveSources(history: MaouMessage[]): MaouMessage[] {
  return history.filter((m) => isFoldArtifact(m) || m.compact?.type === "major" || m.compact?.type === "dead");
}

function fallbackArchiveSummary(cards: MaouMessage[]): string {
  const text = cards.map((m) => m.contents.map(segmentVisibleText).join("\n")).join("\n");
  const chars = [...text];
  return chars.length <= 2000 ? text : `${chars.slice(0, 2000).join("")}…`;
}

function renderArchiveCard(summary: string, path: string | undefined, range: { start: number; end: number } | null): string {
  const loc = path ? ` path="${path}"` : "";
  const span = range ? `${range.start}-${range.end}` : "?";
  return [
    `<archived-context seq="${span}"${loc}>`,
    summary.trim() || "(none)",
    path
      ? `查表文件：${path}。entries[].path 指向工具原文；无 path 的回查会话日志。`
      : "查表未落盘。回查会话日志。",
    `</archived-context>`,
  ].join("\n");
}

async function archiveFoldedRegion(
  history: MaouMessage[],
  opts: ApplyFoldStageInput,
): Promise<{ history: MaouMessage[]; changed: boolean; summary: string; archivePath?: string }> {
  const cards = collectArchiveSources(history);
  if (cards.length === 0) {
    return { history, changed: false, summary: "" };
  }
  let summary = "";
  if (opts.summarizer) {
    try {
      summary = (await opts.summarizer({
        kind: "archive",
        messages: cards.map((m) => ({
          role: "user",
          content: m.contents.map(segmentVisibleText).join("\n"),
        })),
      })).trim();
    } catch {
      summary = "";
    }
  }
  if (!summary) summary = fallbackArchiveSummary(cards);

  const range = seqRangeOf(cards.flatMap((m) => {
    const r = m.compact?.seqRange;
    if (!r) return [m];
    return [{ ...m, seqId: r.start }, { ...m, seqId: r.end }];
  }));
  const id = `fold-${range?.start ?? 0}-${range?.end ?? 0}-${Date.now()}`;
  const archivePath = opts.sessionRoot
    ? writeArchiveLookup(opts.sessionRoot, {
        id,
        createdAt: new Date().toISOString(),
        seqRange: range ?? { start: cards[0]!.seqId, end: cards[cards.length - 1]!.seqId },
        summary,
        entries: archiveEntries(cards),
      })
    : undefined;
  const text = renderArchiveCard(summary, archivePath, range);
  const card: MaouMessage = {
    seqId: range?.start ?? cards[0]!.seqId,
    taskIds: [],
    contents: [{ text }],
    keepAfterCompress: true,
    category: "compact",
    originalRole: "user",
    compact: {
      type: "archive",
      summary: text,
      ...(range ? { seqRange: range } : {}),
      ...(archivePath ? { archivePath } : {}),
    },
  };
  const rest = history.filter((m) => !collectArchiveSources(history).includes(m));
  const next = [...rest, card].sort((a, b) => a.seqId - b.seqId);
  return { history: next, changed: true, summary: text, archivePath };
}

export async function applyFoldStage(
  history: MaouMessage[],
  opts: ApplyFoldStageInput,
): Promise<ApplyFoldStageResult> {
  const cfg = resolveFoldStage(opts.config);
  if (!cfg.enabled) {
    return { history, changed: false, stage: "none", summary: "" };
  }
  const window = opts.window;
  const occupancy = opts.occupancy;
  const trigger = window > 0 ? Math.floor((window * cfg.triggerPercent) / 100) : Number.POSITIVE_INFINITY;
  if (window > 0 && occupancy < trigger) {
    return { history, changed: false, stage: "none", summary: "" };
  }

  const retainCount =
    opts.retainCount != null && opts.retainCount > 0
      ? opts.retainCount
      : Math.max(1, Math.floor(history.length * cfg.retainTailRatio));

  const start = retainStartOf(history, retainCount);
  const head = history.slice(0, start);
  const toFold = head.filter((m) => !skipFoldKeep(m));

  let next = history;
  let changed = false;
  let summary = "";

  if (toFold.length > 0 && opts.customFold) {
    try {
      const custom = await opts.customFold({
        stage: "summary",
        compressible: toFold,
        history,
      });
      if (custom && custom.replacement.length > 0) {
        const keptHead = head.filter((m) => skipFoldKeep(m));
        const cards = markFolded(custom.replacement, toFold);
        next = [...keptHead, ...cards, ...history.slice(start)].sort((a, b) => a.seqId - b.seqId);
        changed = true;
        summary = custom.droppedSummary || cards[0]?.compact?.summary || "";
      }
    } catch {
      /* 自定义失败走默认折叠卡 */
    }
  }

  if (!changed) {
    const folded = foldUnfoldedSpan(history, retainCount);
    next = folded.history;
    changed = folded.changed;
    summary = folded.summary;
  }

  const share = foldedRegionShare(next, window);
  if (window > 0 && share >= cfg.archiveFoldedPercent / 100) {
    const leftover = foldUnfoldedSpan(next, retainCount);
    if (leftover.changed) {
      next = leftover.history;
      changed = true;
      summary = leftover.summary;
    }
    const archived = await archiveFoldedRegion(next, opts);
    if (archived.changed) {
      return {
        history: archived.history,
        changed: true,
        stage: "archive",
        summary: archived.summary,
        archivePath: archived.archivePath,
      };
    }
  }

  if (changed) {
    return { history: next, changed: true, stage: "summary", summary };
  }
  return { history: next, changed: false, stage: "none", summary: "" };
}

/**
 * 传统 llm 方案：一到大压缩阈值就 LLM 摘要，原文进查表文件，上下文只留归档卡 + 路径。
 */
export async function applyLlmMajorCompress(
  history: MaouMessage[],
  opts: ApplyFoldStageInput,
): Promise<ApplyFoldStageResult> {
  const cfg = resolveFoldStage({ ...opts.config, enabled: true });
  const window = opts.window;
  const occupancy = opts.occupancy;
  const trigger = window > 0 ? Math.floor((window * cfg.triggerPercent) / 100) : Number.POSITIVE_INFINITY;
  if (window > 0 && occupancy < trigger) {
    return { history, changed: false, stage: "none", summary: "" };
  }

  const retainCount =
    opts.retainCount != null && opts.retainCount > 0
      ? opts.retainCount
      : Math.max(1, Math.floor(history.length * cfg.retainTailRatio));
  const start = retainStartOf(history, retainCount);
  const head = history.slice(0, start);
  const tail = history.slice(start);
  const toFold = head.filter((m) => !skipFoldKeep(m));
  const keptHead = head.filter((m) => skipFoldKeep(m));
  if (toFold.length === 0) {
    return { history, changed: false, stage: "none", summary: "" };
  }

  if (opts.customFold) {
    try {
      const custom = await opts.customFold({
        stage: "archive",
        compressible: toFold,
        history,
      });
      if (custom && custom.replacement.length > 0) {
        const cards = markFolded(custom.replacement, toFold).map((m) => ({
          ...m,
          compact: { ...m.compact!, type: "archive" as const },
        }));
        return {
          history: [...keptHead, ...cards, ...tail].sort((a, b) => a.seqId - b.seqId),
          changed: true,
          stage: "archive",
          summary: custom.droppedSummary,
        };
      }
    } catch {
      /* 自定义失败走 LLM 归档 */
    }
  }

  let summary = "";
  if (opts.summarizer) {
    try {
      summary = (
        await opts.summarizer({
          kind: "archive",
          messages: toFold.map((m) => ({
            role: m.originalRole === "assistant" || m.originalRole === "system" || m.originalRole === "tool"
              ? m.originalRole
              : "user",
            content: m.contents.map(segmentVisibleText).join("\n"),
          })),
        })
      ).trim();
    } catch {
      summary = "";
    }
  }
  if (!summary) summary = fallbackArchiveSummary(toFold);

  const range = seqRangeOf(toFold);
  const id = `llm-${range?.start ?? 0}-${range?.end ?? 0}-${Date.now()}`;
  const archivePath = opts.sessionRoot
    ? writeArchiveLookup(opts.sessionRoot, {
        id,
        createdAt: new Date().toISOString(),
        seqRange: range ?? { start: toFold[0]!.seqId, end: toFold[toFold.length - 1]!.seqId },
        summary,
        entries: archiveEntries(toFold),
      })
    : undefined;
  const text = renderArchiveCard(summary, archivePath, range);
  const card: MaouMessage = {
    seqId: range?.start ?? toFold[0]!.seqId,
    taskIds: [],
    contents: [{ text }],
    keepAfterCompress: true,
    category: "compact",
    originalRole: "user",
    compact: {
      type: "archive",
      summary: text,
      ...(range ? { seqRange: range } : {}),
      ...(archivePath ? { archivePath } : {}),
    },
  };
  return {
    history: [...keptHead, card, ...tail].sort((a, b) => a.seqId - b.seqId),
    changed: true,
    stage: "archive",
    summary: text,
    archivePath,
  };
}

export function foldStageStep(
  config?: Partial<FoldStageConfig>,
  deps?: { summarizer?: FoldSummarizer; customFold?: CustomFoldFn },
): FoldStep {
  return {
    name: "fold_stage",
    async apply(input) {
      const out = await applyFoldStage(input.history, {
        occupancy: input.knownTokens ?? estimateTokens(input.history),
        window: input.maxTokens ?? 0,
        config: input.foldStage === false ? false : { ...config, ...input.foldStage },
        sessionRoot: input.sessionRoot,
        sessionId: input.sessionId,
        summarizer: deps?.summarizer,
        customFold: deps?.customFold,
      });
      return {
        history: out.history,
        changed: out.changed,
        extras: {
          foldStage: out.stage,
          foldSummary: out.summary,
          archivePath: out.archivePath,
        },
      };
    },
  };
}
