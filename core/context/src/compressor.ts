/**
 * 上下文压缩器 —— 五阶段分阶段自动压缩。
 *
 * 两个入口：
 *   compressMaou()    — async，操作 MaouMessage[]，支持可插拔 Summarizer（LLM 摘要）。
 *   maybeCompress()    — sync compat shim（truncate-only），保持旧签名兼容。
 *
 * 压缩阶段（按 token 占比逐步升级）——对齐 DESIGN：
 *   activeStage  : < 80% maxTokens，不压缩；并定义「最新原文区」边界。
 *   compactStage : >= 80%，先窗压剪超大工具结果；重测后仍超线再走折叠 / 摘要。
 *   summaryStage : >= 80%。fold 方案把还没折过的旧侧收成折叠卡（不新开 LLM）；llm 方案立刻摘要。
 *   archiveStage : fold 方案在折叠区占窗口过半时 LLM 总结并写查表；llm 方案第一次大压缩就是归档卡。
 *   staticStage  : 静态阶段不参与压缩。
 */

import {
  MICRO_TRIGGER_PERCENT,
  SUMMARY_TRIGGER_PERCENT,
  ARCHIVE_TRIGGER_PERCENT,
  MICRO_SINGLE_MSG_CHARS,
  MICRO_SUMMARY_MAX_CHARS,
  SUMMARY_MAX_CHARS,
  SUMMARY_SNIPPET_MAX_CHARS,
  SUMMARY_MAX_ENTRIES_PER_ROLE,
  ACTIVE_WINDOW_PERCENT,
  ACTIVE_WINDOW_MIN_MESSAGES,
  MICRO_OUTSIDE_MIN_CHARS,
  MICRO_TOOL_RESULT_MIN_CHARS,
  RETAIN_TAIL_RATIO,
} from "./constants.js";
import { pruneBodyText, pruneToolResultText } from "./prune-text.js";
import { estimateTokens } from "./token-estimate.js";
import { applyWindowPressure } from "./window-pressure.js";
import { snapRetainStartForToolPairs } from "./tool-pairing.js";
import {
  applyFoldStage,
  applyLlmMajorCompress,
  holdAsPromptCache,
  resolveFoldStage,
  resolveTraditionalMajorScheme,
  type CustomFoldFn,
  type FoldStageConfig,
  type MicroCacheHold,
  type MicroCompactCatalog,
  type TraditionalMajorScheme,
} from "@little-house-studio/context-components";
import type { CompressResult } from "./types.js";
import type {
  CompressionStage,
  CompressionResult,
  TaskSummary,
} from "./types/compression.js";
import type { MaouMessage, MaouContent, LLMMessage } from "./types/message.js";
import { maouToLLMMessage, segmentVisibleText, seqRangeOf } from "./types/message.js";
import type { FoldContext, FoldResult, Summarizer } from "./scheme-extension.js";

export type { Summarizer } from "./scheme-extension.js";

export interface CompressOptions {
  maxTokens: number;
  summarizer?: Summarizer;
  sessionId?: string;
  /** 最大压缩阶段（逐级递进时限制只压到某一级） */
  maxStage?: CompressionStage;
  /** 大压缩/归档折叠；缺省走线性一条摘要 */
  fold?: (ctx: FoldContext) => Promise<FoldResult | null>;
  /**
   * 上一条回报的占用（input + output）。门槛只认这个数。
   */
  knownTokens?: number;
  /**
   * /compact 与超窗抢救：未达 80% 也至少尝试便宜剪；尾巴只留最新一条。
   * 自动压不要开。压完没变矮则仍回 activeStage。
   */
  force?: boolean;
  /**
   * 从尾部留下的原文条数。
   * 未传时：自动压 = 条数 × RETAIN_TAIL_RATIO；force = 只留最新一条。
   */
  retainCount?: number;
  /** @deprecated 当作 retainCount（条数） */
  retainTokens?: number;
  /** 微压缩时钟：出动态轮的消息当缓存前缀，这边不改 */
  microTurn?: number;
  microCatalog?: MicroCompactCatalog;
  microRounds?: number;
  /**
   * 传统大压缩方案：`fold` 先折满了再 LLM；`llm` 一到阈值就摘要并写查表路径。
   * 缺省 fold。`foldStage: false` 等同 llm。
   */
  majorScheme?: TraditionalMajorScheme;
  /** @deprecated 用 majorScheme。false = llm 方案 */
  foldStage?: Partial<FoldStageConfig> | false;
  /** 会话目录：写原记录 / 归档查表 */
  sessionRoot?: string;
}

function resolveRetainCount(
  messageCount: number,
  opts: { retainCount?: number; retainTokens?: number; force?: boolean },
): number {
  if (opts.retainCount != null && opts.retainCount > 0) {
    return Math.max(1, Math.min(messageCount, Math.trunc(opts.retainCount)));
  }
  if (opts.retainTokens != null && opts.retainTokens > 0) {
    if (opts.retainTokens <= messageCount) {
      return Math.max(1, Math.trunc(opts.retainTokens));
    }
    return Math.max(1, Math.floor(messageCount * RETAIN_TAIL_RATIO));
  }
  if (opts.force) return 1;
  return Math.max(1, Math.floor(messageCount * RETAIN_TAIL_RATIO));
}

export interface CompressMaouResult {
  history: MaouMessage[];
  stage: CompressionStage;
  droppedSummary: string;
  blockIds: string[];
  foldedOriginals: Map<string, MaouMessage[]>;
  originalTokens: number;
  compressedTokens: number;
}

// ─── 新主入口（async，操作 MaouMessage[]） ─────────────────────────────────

const STAGE_ORDER: CompressionStage[] = [
  "activeStage",
  "compactStage",
  "summaryStage",
  "archiveStage",
];

function stageIndex(s: CompressionStage): number {
  return STAGE_ORDER.indexOf(s);
}

function occupancyStage(occupancy: number, threshold: number): CompressionStage {
  if (occupancy >= Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100)) {
    return "archiveStage";
  }
  if (occupancy >= Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100)) {
    return "summaryStage";
  }
  if (occupancy >= Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100)) {
    return "compactStage";
  }
  return "activeStage";
}

export async function compressMaou(
  history: MaouMessage[],
  opts: CompressOptions,
): Promise<CompressMaouResult> {
  const threshold = opts.maxTokens > 0 ? opts.maxTokens : 65536;
  const occupancy =
    opts.knownTokens != null && opts.knownTokens > 0
      ? Math.trunc(opts.knownTokens)
      : 0;
  const maxStageIdx = opts.maxStage ? stageIndex(opts.maxStage) : STAGE_ORDER.length - 1;

  const noChange = (): CompressMaouResult => ({
    history,
    stage: "activeStage",
    droppedSummary: "",
    blockIds: [],
    foldedOriginals: new Map(),
    originalTokens: occupancy,
    compressedTokens: occupancy,
  });

  let target = occupancyStage(occupancy, threshold);
  if (opts.force && target === "activeStage") target = "compactStage";
  if (stageIndex(target) > maxStageIdx) {
    target = STAGE_ORDER[maxStageIdx] ?? "activeStage";
  }
  if (target === "activeStage") return noChange();

  const hold: MicroCacheHold = {
    currentTurn: opts.microTurn,
    catalog: opts.microCatalog,
    limitRounds: opts.microRounds,
  };
  const pressed = applyWindowPressure(
    history,
    occupancy,
    threshold,
    (m) => holdAsPromptCache(m, hold),
    opts.sessionRoot,
  );
  const working = pressed.history;

  const retainCount = resolveRetainCount(working.length, opts);
  const afterMicro = await microCompactAll(working, opts.summarizer, retainCount, hold);
  const microChanged = historyVisiblyChanged(history, afterMicro);

  /**
   * 便宜路径剪完后的占用。厂商 token 与启发式估算不可比绝对值，
   * 只能拿同一批消息剪裁前后的比值去缩放锚点。
   */
  const projectOccupancy = (after: MaouMessage[]): number => {
    if (occupancy <= 0) return occupancy;
    const before = estimateTokens(history);
    if (before <= 0) return occupancy;
    const ratio = estimateTokens(after) / before;
    if (!Number.isFinite(ratio) || ratio < 0) return occupancy;
    return Math.trunc(occupancy * Math.min(1, ratio));
  };

  const compactResult = (projected: number): CompressMaouResult => ({
    history: afterMicro,
    stage: "compactStage",
    droppedSummary: "",
    blockIds: [],
    foldedOriginals: new Map(),
    originalTokens: occupancy,
    compressedTokens: projected,
  });

  if (target === "compactStage") {
    if (!microChanged) return noChange();
    return compactResult(projectOccupancy(afterMicro));
  }

  // 剪完重测：便宜路径已经把占用压回摘要线以下就别再花摘要的钱
  if (microChanged && pressed.action === "omit") {
    const projected = projectOccupancy(afterMicro);
    if (stageIndex(occupancyStage(projected, threshold)) < stageIndex("summaryStage")) {
      return compactResult(projected);
    }
  }

  const majorScheme = resolveTraditionalMajorScheme(opts.majorScheme, opts.foldStage);
  const foldCfg = resolveFoldStage(opts.foldStage);
  const majorOpts = {
    occupancy,
    window: threshold,
    config: foldCfg,
    sessionRoot: opts.sessionRoot,
    sessionId: opts.sessionId,
    retainCount,
    customFold: opts.fold
      ? (async ({ stage, compressible, history: hist }) => {
          const r = await opts.fold!({
            stage,
            compressible,
            history: hist,
            summarizer: opts.summarizer,
            sessionId: opts.sessionId,
          });
          if (!r) return null;
          return { replacement: r.replacement, droppedSummary: r.droppedSummary };
        }) satisfies CustomFoldFn
      : undefined,
    summarizer: opts.summarizer
      ? async ({ messages }: { messages: Array<{ role: string; content: string }> }) =>
          opts.summarizer!({
            kind: "summary",
            messages: messages.map((m) => ({
              role: (
                m.role === "assistant" || m.role === "system" || m.role === "tool" ? m.role : "user"
              ) as LLMMessage["role"],
              content: m.content,
            })),
          })
      : undefined,
  };
  const major =
    majorScheme === "llm"
      ? await applyLlmMajorCompress(afterMicro, majorOpts)
      : await applyFoldStage(afterMicro, majorOpts);
  if (major.changed) {
    const stage = major.stage === "archive" ? "archiveStage" : "summaryStage";
    return {
      history: major.history,
      stage,
      droppedSummary: major.summary,
      blockIds: [],
      foldedOriginals: new Map(),
      originalTokens: occupancy,
      compressedTokens: projectOccupancy(major.history),
    };
  }
  if (!microChanged) return noChange();
  return compactResult(projectOccupancy(afterMicro));
}

// ─── 旧签名 compat shim（sync，truncate-only） ──────────────────────────────

export function maybeCompress(
  messages: Record<string, unknown>[],
  maxTokens: number,
  opts?: { knownTokens?: number; force?: boolean; retainCount?: number },
): CompressResult {
  const maou = messages.map((m, i) => rawToMaou(m, i));
  const occupancy =
    opts?.knownTokens != null && opts.knownTokens > 0
      ? Math.trunc(opts.knownTokens)
      : 0;
  const threshold = maxTokens > 0 ? maxTokens : 65536;
  let target = occupancyStage(occupancy, threshold);
  if (opts?.force && target === "activeStage") target = "compactStage";
  if (target === "activeStage") {
    return {
      messages,
      compressed: false,
      droppedSummary: "",
      stage: "activeStage",
      originalTokens: occupancy,
      compressedTokens: occupancy,
    };
  }

  const retainCount = resolveRetainCount(maou.length, {
    retainCount: opts?.retainCount,
    force: opts?.force,
  });
  const afterMicro = microCompactAllSync(maou, retainCount);
  const microChanged = historyVisiblyChanged(maou, afterMicro);
  if (target === "compactStage") {
    if (!microChanged) {
      return {
        messages,
        compressed: false,
        droppedSummary: "",
        stage: "activeStage",
        originalTokens: occupancy,
        compressedTokens: occupancy,
      };
    }
    return buildLegacyResult(afterMicro, occupancy, "compactStage");
  }

  const afterSummary = summaryCompressLinear(afterMicro, retainCount);
  if (target === "summaryStage") {
    if (!historyVisiblyChanged(afterMicro, afterSummary.messages)) {
      if (!microChanged) {
        return {
          messages,
          compressed: false,
          droppedSummary: "",
          stage: "activeStage",
          originalTokens: occupancy,
          compressedTokens: occupancy,
        };
      }
      return buildLegacyResult(afterMicro, occupancy, "compactStage");
    }
    return buildLegacyResult(
      afterSummary.messages,
      occupancy,
      "summaryStage",
      afterSummary.summary,
      afterSummary.blockIds,
    );
  }

  const afterArchive = archiveCompressLinear(afterSummary);
  return buildLegacyResult(
    afterArchive.messages,
    occupancy,
    "archiveStage",
    afterArchive.summary,
    afterArchive.blockIds,
  );
}

// ─── active / 原始上下文区（DESIGN：微压缩与大压缩共用） ────────────────────

/**
 * 条数窗口（旧）。新路径用 {@link retainTailBoundary}。
 */
export function activeWindowBoundary(messageCount: number): number {
  if (messageCount <= 0) return 0;
  const pctKeep = Math.floor((messageCount * ACTIVE_WINDOW_PERCENT) / 100);
  const keep = Math.min(
    messageCount,
    Math.max(ACTIVE_WINDOW_MIN_MESSAGES, pctKeep, 1),
  );
  return Math.max(0, messageCount - keep);
}

/**
 * 从尾部按条数留原文，切点再咬合 tool 对。
 * 最新一条始终留下。
 */
export function retainTailBoundary(
  messages: MaouMessage[],
  retainCount: number,
): number {
  if (messages.length === 0) return 0;
  const keep = Math.min(messages.length, Math.max(1, Math.trunc(retainCount)));
  return snapRetainStartForToolPairs(messages, messages.length - keep);
}

/** active 区消息的 seqId 集合 */
export function activeWindowSeqIds(
  messages: MaouMessage[],
  retainTokens?: number,
): Set<number> {
  const b =
    retainTokens != null && retainTokens > 0
      ? retainTailBoundary(messages, retainTokens)
      : activeWindowBoundary(messages.length);
  const s = new Set<number>();
  for (let i = b; i < messages.length; i++) s.add(messages[i]!.seqId);
  return s;
}

export function historyVisiblyChanged(
  before: MaouMessage[],
  after: MaouMessage[],
): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < after.length; i++) {
    const a = after[i]!;
    const b = before[i]!;
    if (a.seqId !== b.seqId) return true;
    const as = a.contents[0]?.microCompact?.summary ?? "";
    const bs = b.contents[0]?.microCompact?.summary ?? "";
    const ae = a.contents[0]?.microCompact?.enabled === true;
    const be = b.contents[0]?.microCompact?.enabled === true;
    if (ae !== be || as !== bs) return true;
  }
  return false;
}

// ─── 微压缩（滑动窗口：从最新往前保留 active 区，旧侧压缩） ────────────────

/**
 * 微压缩 = 滑动窗口，不需要 LLM。
 *
 * 最新原文区按条数留下（切边咬合 tool 对）；旧侧头尾剪。
 */
async function microCompactAll(
  messages: MaouMessage[],
  _summarizer?: Summarizer,
  retainTokens?: number,
  hold?: MicroCacheHold,
): Promise<MaouMessage[]> {
  void _summarizer;
  return microCompactAllSync(messages, retainTokens, hold);
}

function microCompactAllSync(
  messages: MaouMessage[],
  retainTokens?: number,
  hold?: MicroCacheHold,
): MaouMessage[] {
  const boundary =
    retainTokens != null && retainTokens > 0
      ? retainTailBoundary(messages, retainTokens)
      : activeWindowBoundary(messages.length);

  return messages.map((m, i) => {
    if (i >= boundary) return m;
    if (shouldSkipCompress(m, hold)) return m;
    const hasSummary = m.contents.some((c) => c.microCompact?.enabled && c.microCompact.summary);
    if (hasSummary) return m;

    const fullText = m.contents.map((c) => c.text).join("\n");
    const hasMetaCompact = m.meta?.microCompact?.enabled === true;
    const shouldAutoCompact =
      hasMetaCompact ||
      fullText.length > MICRO_SINGLE_MSG_CHARS ||
      (m.category === "tool_result" && fullText.length > MICRO_TOOL_RESULT_MIN_CHARS) ||
      fullText.length > MICRO_OUTSIDE_MIN_CHARS;
    if (!shouldAutoCompact) return m;

    const summary = compactByCategory(m);
    if (!summary || summary === fullText) return m;
    const newContents = [...m.contents];
    if (newContents.length > 0) {
      newContents[0] = { ...newContents[0]!, microCompact: { enabled: true, summary } };
    }
    return { ...m, contents: newContents };
  });
}

function shouldSkipCompress(m: MaouMessage, hold?: MicroCacheHold): boolean {
  if (m.category === "system") return true;
  if (m.pinned || m.keepAfterCompress) return true;
  if (holdAsPromptCache(m, hold)) return true;
  return false;
}

function compactByCategory(m: MaouMessage): string {
  const text = m.contents.map((c) => c.text).join("\n");
  if (m.category === "tool_result") {
    return pruneToolResultText(text) ?? text;
  }
  if (m.category === "tool_call") {
    return pruneBodyText(text, 240) ?? text;
  }
  const pruned = pruneBodyText(text, MICRO_SUMMARY_MAX_CHARS);
  if (pruned) return pruned;
  if (text.length > MICRO_SUMMARY_MAX_CHARS) {
    const label =
      m.category === "user" ? "用户" : m.category === "assistant" ? "助手" : m.category;
    return `[${label}] ${truncate(text, MICRO_SUMMARY_MAX_CHARS)}`;
  }
  return text;
}

// ─── 大压缩 ──────────────────────────────────────────────────────────────────

interface SummaryCompressResult {
  messages: MaouMessage[];
  summary: string;
  blockIds: string[];
  foldedOriginals: Map<string, MaouMessage[]>;
  extras?: Record<string, unknown>;
  activeRawMsgs: MaouMessage[];
}

function assembleFoldedHistory(
  parts: ReturnType<typeof partitionMessages>,
  replacement: MaouMessage[],
): MaouMessage[] {
  return [
    ...parts.systemMsgs,
    ...parts.pinnedOrCritical,
    ...replacement,
    ...parts.recentToolMsgs,
    ...parts.activeRawMsgs,
  ].sort((a, b) => a.seqId - b.seqId);
}

function fallbackLinearSummary(msgs: MaouMessage[]): string {
  const parts: string[] = [];
  let users = 0;
  let assistants = 0;
  let tools = 0;
  for (const m of msgs) {
    const text = m.contents.map((c) => c.text).join("\n");
    switch (m.category) {
      case "user":
        users++;
        parts.push(`用户: ${truncate(text, 100)}`);
        break;
      case "assistant":
        assistants++;
        parts.push(`助手: ${truncate(text, 150)}`);
        break;
      case "tool_call":
      case "tool_result":
        tools++;
        break;
    }
  }
  const head = `[历史 ${users} 条用户 / ${assistants} 条助手 / ${tools} 条工具]`;
  return truncate(`${head}\n${parts.slice(0, 8).join("\n")}`, SUMMARY_MAX_CHARS);
}

function attachSummaryRange(summaryMsg: MaouMessage, originals: MaouMessage[], summary: string): MaouMessage {
  const range = seqRangeOf(originals);
  if (!range) return summaryMsg;
  return { ...summaryMsg, compact: { type: "major", summary, seqRange: range } };
}

function summaryFromFold(
  parts: ReturnType<typeof partitionMessages>,
  folded: FoldResult,
): SummaryCompressResult {
  return {
    messages: assembleFoldedHistory(parts, folded.replacement),
    summary: folded.droppedSummary,
    blockIds: folded.blockIds ?? [],
    foldedOriginals: folded.foldedOriginals ?? new Map(),
    extras: folded.extras,
    activeRawMsgs: parts.activeRawMsgs,
  };
}

async function summaryCompressHarness(
  messages: MaouMessage[],
  summarizer?: Summarizer,
  retainTokens?: number,
  fold?: (ctx: FoldContext) => Promise<FoldResult | null>,
  sessionId?: string,
  hold?: MicroCacheHold,
): Promise<SummaryCompressResult> {
  const parts = partitionMessages(messages, { protectActiveWindow: true, retainTokens, hold });
  if (fold) {
    const folded = await fold({
      stage: "summary",
      compressible: parts.compressible,
      history: messages,
      summarizer,
      sessionId,
    });
    if (folded) return summaryFromFold(parts, folded);
  }
  if (summarizer) {
    try {
      const summaryText = await summarizer({
        kind: "summary",
        messages: parts.compressible.map(maouToLLMMessage),
      });
      return finishLinearSummary(parts, summaryText);
    } catch {
      /* 回退确定性摘要 */
    }
  }
  return finishLinearSummary(parts, fallbackLinearSummary(parts.compressible));
}

function finishLinearSummary(
  parts: ReturnType<typeof partitionMessages>,
  summaryText: string,
): SummaryCompressResult {
  const summaryMsg = attachSummaryRange(makeSummaryMessage(summaryText), parts.compressible, summaryText);
  return {
    messages: assembleFoldedHistory(parts, [summaryMsg]),
    summary: buildDroppedSummary(parts.compressible, summaryText),
    blockIds: [],
    foldedOriginals: new Map(),
    activeRawMsgs: parts.activeRawMsgs,
  };
}

function summaryCompressLinear(
  messages: MaouMessage[],
  retainTokens?: number,
  hold?: MicroCacheHold,
): SummaryCompressResult {
  const parts = partitionMessages(messages, { protectActiveWindow: true, retainTokens, hold });
  return finishLinearSummary(parts, fallbackLinearSummary(parts.compressible));
}

/**
 * 分区。protectActiveWindow=true（默认大压缩）时：
 * 与 micro 同一 active 边界内的非 system 消息 → activeRawMsgs（原文保留）。
 */
function partitionMessages(
  messages: MaouMessage[],
  opts?: { protectActiveWindow?: boolean; retainTokens?: number; hold?: MicroCacheHold },
) {
  const systemMsgs: MaouMessage[] = [];
  const pinnedOrCritical: MaouMessage[] = [];
  const compressible: MaouMessage[] = [];
  const activeRawMsgs: MaouMessage[] = [];
  const protect = opts?.protectActiveWindow !== false;
  const activeSeq = protect
    ? activeWindowSeqIds(messages, opts?.retainTokens)
    : new Set<number>();

  const protectedToolCallIds = new Set<string>();
  for (const m of messages) {
    if (m.toolCalls) for (const tc of m.toolCalls) if (tc.id) protectedToolCallIds.add(tc.id);
  }
  // 近 tool 链仅在「可压旧侧」内保留额外保护；已在 active 内的不必重复
  const recentToolChain = collectRecentToolChain(messages, protectedToolCallIds);

  for (const m of messages) {
    if (m.category === "system") {
      systemMsgs.push(m);
      continue;
    }
    if (m.pinned || m.keepAfterCompress || holdAsPromptCache(m, opts?.hold)) {
      // 已是 task_summary 等 keep 消息：若落在 active 区仍算 pin 集合，避免重复进 activeRaw
      pinnedOrCritical.push(m);
      continue;
    }
    // DESIGN active 原文区：整段保留，不进可压池
    if (protect && activeSeq.has(m.seqId)) {
      activeRawMsgs.push(m);
      continue;
    }
    if (recentToolChain.has(m.seqId)) {
      /* handled as recentToolMsgs */
      continue;
    }
    compressible.push(m);
  }

  const recentToolMsgs = messages.filter(
    (m) =>
      recentToolChain.has(m.seqId) &&
      !(protect && activeSeq.has(m.seqId)) &&
      !m.pinned &&
      !m.keepAfterCompress &&
      m.category !== "system",
  );
  return {
    systemMsgs,
    pinnedOrCritical,
    recentToolChain,
    compressible,
    recentToolMsgs,
    activeRawMsgs,
  };
}

function collectRecentToolChain(messages: MaouMessage[], protectedIds: Set<string>): Set<number> {
  const seqIds = new Set<number>();
  const RECENT_PAIRS = 2;
  let pairs = 0;
  for (let i = messages.length - 1; i >= 0 && pairs < RECENT_PAIRS; i--) {
    const m = messages[i];
    if (m.category === "tool_result") {
      seqIds.add(m.seqId);
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev.category !== "tool_call") continue;
        const matched = prev.toolCalls?.some(tc => tc.id && protectedIds.has(tc.id) && tc.id === m.toolCallId);
        if (matched) { seqIds.add(prev.seqId); pairs++; break; }
      }
    }
  }
  return seqIds;
}

// ─── 死阶段归档 ────────────────────────────────────────────────────────────────

async function archiveCompressHarness(
  input: SummaryCompressResult,
  fold?: (ctx: FoldContext) => Promise<FoldResult | null>,
  sessionId?: string,
  hold?: MicroCacheHold,
): Promise<{ messages: MaouMessage[]; summary: string; blockIds: string[] }> {
  if (fold) {
    const folded = await fold({
      stage: "archive",
      compressible: [],
      history: input.messages,
      sessionId,
      prior: {
        replacement: input.messages,
        droppedSummary: input.summary,
        foldedOriginals: input.foldedOriginals,
        blockIds: input.blockIds,
        extras: {
          ...input.extras,
          activeRawSeqs: input.activeRawMsgs.map((m) => m.seqId),
        },
      },
    });
    if (folded) {
      return {
        messages: folded.replacement,
        summary: folded.droppedSummary,
        blockIds: folded.blockIds ?? input.blockIds,
      };
    }
  }
  return archiveCompressLinear(input, hold);
}

function archiveCompressLinear(
  input: SummaryCompressResult,
  hold?: MicroCacheHold,
): { messages: MaouMessage[]; summary: string; blockIds: string[] } {
  const systemMsgs = input.messages.filter((m) => m.category === "system");
  const pinned = input.messages.filter(
    (m) =>
      (m.pinned || m.keepAfterCompress || holdAsPromptCache(m, hold)) &&
      !input.activeRawMsgs.some((a) => a.seqId === m.seqId),
  );
  const snippet = input.summary.length > 400 ? `${input.summary.slice(0, 400)}…` : input.summary;
  const archiveText = snippet ? `[已归档]\n${snippet}` : "[已归档]";
  return {
    messages: [
      ...systemMsgs,
      makeSummaryMessage(archiveText),
      ...pinned,
      ...input.activeRawMsgs,
    ].sort((a, b) => a.seqId - b.seqId),
    summary: archiveText,
    blockIds: [],
  };
}

function buildDroppedSummary(dropped: MaouMessage[], taskSummary: string): string {
  if (dropped.length === 0) return "";
  const userSnippets: string[] = [];
  const assistantSnippets: string[] = [];
  let userCount = 0;
  let assistantCount = 0;

  for (const m of dropped) {
    const text = m.contents.map(c => c.text).join('\n').trim();
    if (!text) continue;
    if (m.category === "user") {
      userCount++;
      userSnippets.push(text.length > SUMMARY_SNIPPET_MAX_CHARS ? text.slice(0, SUMMARY_SNIPPET_MAX_CHARS) + "…" : text);
    } else if (m.category === "assistant") {
      assistantCount++;
      assistantSnippets.push(text.length > SUMMARY_SNIPPET_MAX_CHARS ? text.slice(0, SUMMARY_SNIPPET_MAX_CHARS) + "…" : text);
    }
  }

  const lines: string[] = [];
  lines.push(`[被压缩掉的历史：${userCount} 条 user + ${assistantCount} 条 assistant]`);
  if (taskSummary.trim()) lines.push("\n摘要：\n" + taskSummary);
  if (userSnippets.length > 0) {
    lines.push("用户此前说过：");
    for (const s of userSnippets.slice(0, SUMMARY_MAX_ENTRIES_PER_ROLE)) lines.push(`- ${s}`);
    if (userSnippets.length > SUMMARY_MAX_ENTRIES_PER_ROLE) lines.push(`- …（另 ${userSnippets.length - SUMMARY_MAX_ENTRIES_PER_ROLE} 条略）`);
  }
  if (assistantSnippets.length > 0) {
    lines.push("助手此前答复要点：");
    for (const s of assistantSnippets.slice(0, SUMMARY_MAX_ENTRIES_PER_ROLE)) lines.push(`- ${s}`);
    if (assistantSnippets.length > SUMMARY_MAX_ENTRIES_PER_ROLE) lines.push(`- …（另 ${assistantSnippets.length - SUMMARY_MAX_ENTRIES_PER_ROLE} 条略）`);
  }
  return lines.join("\n");
}

export function makeSummaryMessage(summary: string): MaouMessage {
  return {
    seqId: -1,
    taskIds: [],
    contents: [{
      text:
        `<prior_context_summary>\n` +
        `以下是此前对话中被压缩掉的摘要，供参考以保持上下文连贯性：\n\n` +
        `${summary}\n` +
        `</prior_context_summary>`,
    }],
    keepAfterCompress: true,
    category: "injected",
    originalRole: "user",
  };
}

/**
 * 生成单个 task 的摘要消息（#1：每个 task 独立显示，按时间流程排序）。
 *
 * 用 task 块第一条消息的 seqId 作为排序键，使压缩区内
 * 多个 task 摘要按原始时间顺序排列，展示任务执行流程。
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

// ─── 旧签名辅助 ─────────────────────────────────────────────────────────────

function rawToMaou(raw: Record<string, unknown>, seqId: number): MaouMessage {
  const role = String(raw.role ?? "user");
  const content = extractText(raw.content);
  const pinned = Boolean(raw.pinned ?? false);

  let category: MaouMessage["category"];
  if (role === "system") category = "system";
  else if (role === "assistant") {
    const tc = raw.tool_calls as Array<Record<string, unknown>> | undefined;
    category = tc && tc.length > 0 ? "tool_call" : "assistant";
  } else if (role === "tool") category = "tool_result";
  else category = "user";

  const toolCalls = (category === "tool_call" || category === "assistant")
    ? normalizeToolCalls(raw.tool_calls as Array<Record<string, unknown>> | undefined)
    : undefined;

  const mmsg: MaouMessage = {
    seqId, taskIds: [], contents: [{ text: content }],
    keepAfterCompress: pinned, category, pinned,
    originalRole: role as MaouMessage["originalRole"],
  };
  if (typeof raw.tool_call_id === "string") mmsg.toolCallId = raw.tool_call_id;
  if (toolCalls && toolCalls.length > 0) mmsg.toolCalls = toolCalls;
  return mmsg;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in (part as Record<string, unknown>)) return String((part as { text?: unknown }).text ?? "");
      return "";
    }).join("");
  }
  return "";
}

function normalizeToolCalls(calls: Array<Record<string, unknown>> | undefined): MaouMessage["toolCalls"] {
  if (!calls || calls.length === 0) return undefined;
  return calls.map(c => {
    const fn = (c.function ?? c) as Record<string, unknown>;
    const id = String(c.id ?? "");
    const name = String(fn.name ?? c.name ?? "");
    const argsRaw = fn.arguments ?? c.arguments ?? {};
    let argumentsObj: Record<string, unknown> = {};
    if (typeof argsRaw === "string") { try { argumentsObj = JSON.parse(argsRaw); } catch { argumentsObj = { raw: argsRaw }; } }
    else if (argsRaw && typeof argsRaw === "object") argumentsObj = argsRaw as Record<string, unknown>;
    return { id, name, arguments: argumentsObj };
  }).filter(c => c.id && c.name);
}

function maouToRaw(mmsg: MaouMessage): Record<string, unknown> {
  const fullText = mmsg.contents.map(segmentVisibleText).join("\n");
  const out: Record<string, unknown> = {
    role: mmsg.originalRole ?? categoryToRole(mmsg.category),
    content: fullText,
  };
  if (mmsg.category === "tool_result" && mmsg.toolCallId) out.tool_call_id = mmsg.toolCallId;
  if (mmsg.toolCalls && mmsg.toolCalls.length > 0) {
    out.tool_calls = mmsg.toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } }));
  }
  if (mmsg.pinned) out.pinned = true;
  return out;
}

function categoryToRole(c: MaouMessage["category"]): string {
  switch (c) {
    case "user": case "injected": return "user";
    case "assistant": case "tool_call": return "assistant";
    case "tool_result": return "tool";
    case "system": return "system";
    default: return "user";
  }
}

function buildLegacyResult(maouOut: MaouMessage[], originalTokens: number, stage: CompressionStage, summary = "", taskBlocks: string[] = []): CompressResult {
  const rawOut = maouOut.map(maouToRaw);
  return {
    messages: rawOut, compressed: stage !== "activeStage", droppedSummary: summary,
    stage, originalTokens, compressedTokens: 0, taskBlocks: taskBlocks.length > 0 ? taskBlocks : undefined,
  };
}

// ─── 对外透出 ────────────────────────────────────────────────────────────────

export type { CompressionStage, CompressionResult, TaskSummary };
export { estimateTokens, estimateTokensFromText } from "./token-estimate.js";
