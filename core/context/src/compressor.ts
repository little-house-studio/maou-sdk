/**
 * 上下文压缩器 —— 五阶段分阶段自动压缩。
 *
 * 两个入口：
 *   compressMaou()    — async，操作 MaouMessage[]，支持可插拔 Summarizer（LLM 摘要）。
 *   maybeCompress()    — sync compat shim（truncate-only），保持旧签名兼容。
 *
 * 压缩阶段（按 token 占比逐步升级）——对齐 DESIGN：
 *   activeStage  : < 70% maxTokens，不压缩；并定义「最新原文区」边界。
 *   compactStage : >= 70%，微压缩——仅 active 区以外；标注/超长/工具结果。
 *   summaryStage : 仍 >= 80%，大压缩——仅 active 区以外按 task 摘要；**active 原文整段保留**。
 *   archiveStage : 仍 >= 90%，归档旧侧；**仍保留 active 原文区**。
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
import { snapRetainStartForToolPairs } from "./tool-pairing.js";
import type { CompressResult } from "./types.js";
import type {
  CompressionStage,
  CompressionResult,
  TaskSummary,
} from "./types/compression.js";
import type { MaouMessage, MaouContent, LLMMessage } from "./types/message.js";
import { maouToLLMMessage } from "./types/message.js";
import { estimateTokens, estimateTokensFromText } from "./token-estimate.js";

// ─── 可插拔摘要器 ────────────────────────────────────────────────────────────

export type Summarizer = (input: {
  kind: 'task' | 'micro';
  taskId?: string;
  messages: LLMMessage[];
  /** 可选：覆盖默认压缩提示词（由 agent 的 compression/compression.md 注入）。 */
  prompt?: string;
}) => Promise<string>;

export interface CompressOptions {
  maxTokens: number;
  summarizer?: Summarizer;
  sessionId?: string;
  /** 最大压缩阶段（逐级递进时限制只压到某一级） */
  maxStage?: CompressionStage;
  /**
   * 当前活跃的 task 块 ID 列表（#4：压缩时屏蔽无关 task）。
   * 传入时：只有 activeTaskIds 中的 task 摘要进入压缩区显示，
   * 非 active task 的摘要只进 droppedSummary（归档），不进工作上下文。
   * 未传：所有 task 摘要都进压缩区（兼容旧行为）。
   */
  activeTaskIds?: string[];
  /**
   * 真实/全量上下文 token（含 system+tools 时通常 > history 估算）。
   * 用于门槛判定；阶段内再压仍用 history 估算衡量是否够矮。
   */
  knownTokens?: number;
  /**
   * 强制至少尝试微压缩（/compact、UI）。
   * 跳过 activeStage 的「未达 70% 不压」早退；压完没变矮则仍回 activeStage。
   */
  force?: boolean;
  /**
   * 从尾部按 token 留的原文预算。
   * 未传时：自动压 = maxTokens × RETAIN_TAIL_RATIO；force（/compact、超窗）= 只留最新一条。
   */
  retainTokens?: number;
}

function resolveRetainTokens(opts: {
  maxTokens: number;
  retainTokens?: number;
  force?: boolean;
}): number {
  if (opts.retainTokens != null && opts.retainTokens > 0) return opts.retainTokens;
  if (opts.force) return 1;
  const threshold = opts.maxTokens > 0 ? opts.maxTokens : 65536;
  return Math.max(1, Math.floor(threshold * RETAIN_TAIL_RATIO));
}

export interface CompressMaouResult {
  history: MaouMessage[];
  stage: CompressionStage;
  droppedSummary: string;
  taskBlocks: string[];
  perTaskOriginals: Map<string, MaouMessage[]>;
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

export async function compressMaou(
  history: MaouMessage[],
  opts: CompressOptions,
): Promise<CompressMaouResult> {
  const threshold = opts.maxTokens > 0 ? opts.maxTokens : 65536;
  const historyTokens = estimateTokens(history);
  // 门槛用 knownTokens（API/全量估算）与 history 估算取大，避免「UI 已满、history 低估」不压
  const originalTokens =
    opts.knownTokens != null && opts.knownTokens > 0
      ? Math.max(opts.knownTokens, historyTokens)
      : historyTokens;
  // system/tools 等固定开销：阶段是否够矮要按「history 后 + overhead」估整包
  const fixedOverhead = Math.max(0, originalTokens - historyTokens);
  const effective = (histTok: number) => histTok + fixedOverhead;
  const maxStageIdx = opts.maxStage ? stageIndex(opts.maxStage) : STAGE_ORDER.length - 1;

  const noChange = (): CompressMaouResult => ({
    history,
    stage: "activeStage",
    droppedSummary: "",
    taskBlocks: [],
    perTaskOriginals: new Map(),
    originalTokens,
    compressedTokens: originalTokens,
  });

  // activeStage（force 时跳过，至少走微压缩）
  if (
    !opts.force &&
    originalTokens < Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100)
  ) {
    return noChange();
  }

  // compactStage（微压缩）
  if (maxStageIdx < stageIndex("compactStage")) return noChange();
  const retainTokens = resolveRetainTokens(opts);
  const afterMicro = await microCompactAll(history, opts.summarizer, retainTokens);
  const microHist = estimateTokens(afterMicro);
  const microTokens = effective(microHist);
  const microChanged = historyVisiblyChanged(history, afterMicro);
  if (microTokens < Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100)) {
    if (!microChanged) return noChange();
    return {
      history: afterMicro,
      stage: "compactStage",
      droppedSummary: "",
      taskBlocks: [],
      perTaskOriginals: new Map(),
      originalTokens,
      compressedTokens: microTokens,
    };
  }

  // summaryStage（大压缩）
  if (maxStageIdx < stageIndex("summaryStage")) {
    if (!microChanged) return noChange();
    return {
      history: afterMicro,
      stage: "compactStage",
      droppedSummary: "",
      taskBlocks: [],
      perTaskOriginals: new Map(),
      originalTokens,
      compressedTokens: microTokens,
    };
  }
  const afterSummary = await summaryCompressHarness(
    afterMicro,
    opts.summarizer,
    opts.activeTaskIds,
    retainTokens,
  );
  const summaryHist = estimateTokens(afterSummary.messages);
  const summaryTokens = effective(summaryHist);
  const summaryChanged = historyVisiblyChanged(afterMicro, afterSummary.messages);
  if (summaryTokens < Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100)) {
    if (!summaryChanged) {
      if (!microChanged) return noChange();
      return {
        history: afterMicro,
        stage: "compactStage",
        droppedSummary: "",
        taskBlocks: [],
        perTaskOriginals: new Map(),
        originalTokens,
        compressedTokens: microTokens,
      };
    }
    return {
      history: afterSummary.messages,
      stage: "summaryStage",
      droppedSummary: afterSummary.summary,
      taskBlocks: afterSummary.taskBlocks,
      perTaskOriginals: afterSummary.perTaskOriginals,
      originalTokens,
      compressedTokens: summaryTokens,
    };
  }

  // archiveStage（归档阶段）
  if (maxStageIdx < stageIndex("archiveStage")) {
    // maxStage 限制在 summaryStage，到此为止
    return {
      history: afterSummary.messages,
      stage: "summaryStage",
      droppedSummary: afterSummary.summary,
      taskBlocks: afterSummary.taskBlocks,
      perTaskOriginals: afterSummary.perTaskOriginals,
      originalTokens,
      compressedTokens: summaryTokens,
    };
  }
  const afterArchive = archiveCompressHarness(afterSummary);
  return {
    history: afterArchive.messages,
    stage: "archiveStage",
    droppedSummary: afterArchive.summary,
    taskBlocks: afterArchive.taskBlocks,
    perTaskOriginals: afterSummary.perTaskOriginals,
    originalTokens,
    compressedTokens: effective(estimateTokens(afterArchive.messages)),
  };
}

// ─── 旧签名 compat shim（sync，truncate-only） ──────────────────────────────

export function maybeCompress(
  messages: Record<string, unknown>[],
  maxTokens: number,
  opts?: { knownTokens?: number; force?: boolean },
): CompressResult {
  const maou = messages.map((m, i) => rawToMaou(m, i));
  const historyTokens = estimateTokens(maou);
  const originalTokens =
    opts?.knownTokens != null && opts.knownTokens > 0
      ? Math.max(opts.knownTokens, historyTokens)
      : historyTokens;
  const threshold = maxTokens > 0 ? maxTokens : 65536;

  if (
    !opts?.force &&
    originalTokens < Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100)
  ) {
    return { messages, compressed: false, droppedSummary: "", stage: "activeStage", originalTokens, compressedTokens: historyTokens };
  }

  const retainTokens = resolveRetainTokens({
    maxTokens: threshold,
    force: opts?.force,
  });
  const afterMicro = microCompactAllSync(maou, retainTokens);
  const microTokens = estimateTokens(afterMicro);
  if (microTokens < Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100)) {
    if (!historyVisiblyChanged(maou, afterMicro)) {
      return { messages, compressed: false, droppedSummary: "", stage: "activeStage", originalTokens, compressedTokens: historyTokens };
    }
    return buildLegacyResult(afterMicro, originalTokens, "compactStage");
  }

  const afterSummary = summaryCompressSync(afterMicro, retainTokens);
  const summaryTokens = estimateTokens(afterSummary.messages);
  if (summaryTokens < Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100)) {
    if (!historyVisiblyChanged(afterMicro, afterSummary.messages)) {
      if (!historyVisiblyChanged(maou, afterMicro)) {
        return { messages, compressed: false, droppedSummary: "", stage: "activeStage", originalTokens, compressedTokens: historyTokens };
      }
      return buildLegacyResult(afterMicro, originalTokens, "compactStage");
    }
    return buildLegacyResult(afterSummary.messages, originalTokens, "summaryStage", afterSummary.summary, afterSummary.taskBlocks);
  }

  const afterArchive = archiveCompressHarness(afterSummary);
  return buildLegacyResult(afterArchive.messages, originalTokens, "archiveStage", afterArchive.summary, afterArchive.taskBlocks);
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
 * 从尾部按 token 预算留原文，切点再咬合 tool 对。
 * 最新一条即使单独超过预算也整条留下。
 */
export function retainTailBoundary(
  messages: MaouMessage[],
  retainTokens: number,
): number {
  if (messages.length === 0) return 0;
  const budget = Math.max(1, retainTokens);
  let acc = 0;
  let i = messages.length - 1;
  while (i >= 0) {
    const t = Math.max(1, estimateTokens([messages[i]!]));
    if (acc > 0 && acc + t > budget) break;
    acc += t;
    i -= 1;
  }
  return snapRetainStartForToolPairs(messages, i + 1);
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
  if (estimateTokens(after) < estimateTokens(before)) return true;
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
 * 最新原文区按 token 预算留下（切边咬合 tool 对）；旧侧头尾剪。
 */
async function microCompactAll(
  messages: MaouMessage[],
  _summarizer?: Summarizer,
  retainTokens?: number,
): Promise<MaouMessage[]> {
  void _summarizer;
  return microCompactAllSync(messages, retainTokens);
}

function microCompactAllSync(
  messages: MaouMessage[],
  retainTokens?: number,
): MaouMessage[] {
  const boundary =
    retainTokens != null && retainTokens > 0
      ? retainTailBoundary(messages, retainTokens)
      : activeWindowBoundary(messages.length);

  return messages.map((m, i) => {
    if (i >= boundary) return m;
    if (shouldSkipCompress(m)) return m;
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

function shouldSkipCompress(m: MaouMessage): boolean {
  if (m.category === "system") return true;
  if (m.pinned || m.keepAfterCompress) return true;
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
  taskBlocks: string[];
  perTaskOriginals: Map<string, MaouMessage[]>;
  /** 每个 task 的摘要文本（#1：archiveStage 保留每 task 摘要片段 + task id 展示层级） */
  perTaskSummaries: Map<string, string>;
  /** DESIGN active 原文区（与 micro 同边界），大压缩/归档后仍附在工作集尾部 */
  activeRawMsgs: MaouMessage[];
}

async function summaryCompressHarness(
  messages: MaouMessage[],
  summarizer?: Summarizer,
  activeTaskIds?: string[],
  retainTokens?: number,
): Promise<SummaryCompressResult> {
  const {
    systemMsgs,
    pinnedOrCritical,
    compressible,
    recentToolMsgs,
    activeRawMsgs,
  } = partitionMessages(messages, { protectActiveWindow: true, retainTokens });
  const groups = groupByTask(compressible);
  const taskBlocks: string[] = [];
  const summaryLines: string[] = [];
  const perTaskOriginals = new Map<string, MaouMessage[]>();
  const perTaskSummaries = new Map<string, string>();
  const activeSet = new Set(activeTaskIds ?? []);
  const filterActive = activeSet.size > 0;

  // #1：并行调 summarizer（第一次压缩用 agent 写摘要/大纲，并行加速）
  const taskEntries = [...groups];
  const summaryResults = await Promise.all(taskEntries.map(async ([taskId, msgs]) => {
    perTaskOriginals.set(taskId, msgs);
    let taskSummaryText: string;
    if (summarizer) {
      try {
        const llmMsgs = msgs.map(maouToLLMMessage);
        taskSummaryText = await summarizer({ kind: 'task', taskId, messages: llmMsgs });
      } catch { taskSummaryText = summarizeTaskFallback(taskId, msgs).summary; }
    } else {
      taskSummaryText = summarizeTaskFallback(taskId, msgs).summary;
    }
    return { taskId, msgs, summary: taskSummaryText };
  }));

  // 每个 task 生成独立摘要消息（#1：按时间流程排序显示在压缩区）
  // #4：非 active task 的摘要不进压缩区（屏蔽归档），只进 droppedSummary
  const taskSummaryMsgs: MaouMessage[] = [];
  for (const { taskId, msgs, summary: taskSummaryText } of summaryResults) {
    perTaskSummaries.set(taskId, taskSummaryText);
    summaryLines.push(taskSummaryText);
    taskBlocks.push(taskId);
    if (!filterActive || activeSet.has(taskId)) {
      // active task 或未传 activeTaskIds：进压缩区显示
      taskSummaryMsgs.push(makeTaskSummaryMessage(taskId, taskSummaryText, msgs));
    }
  }

  const summary = summaryLines.join("\n\n");
  // 工作集 = 旧侧摘要 + pin + 近 tool + **active 原文区**（DESIGN）
  const result: MaouMessage[] = [
    ...systemMsgs,
    ...pinnedOrCritical,
    ...taskSummaryMsgs,
    ...recentToolMsgs,
    ...activeRawMsgs,
  ];

  return {
    messages: result.sort((a, b) => a.seqId - b.seqId),
    summary: buildDroppedSummary(compressible, summary),
    taskBlocks,
    perTaskOriginals,
    perTaskSummaries,
    activeRawMsgs,
  };
}

function summaryCompressSync(
  messages: MaouMessage[],
  retainTokens?: number,
): SummaryCompressResult {
  const {
    systemMsgs,
    pinnedOrCritical,
    recentToolMsgs,
    compressible,
    activeRawMsgs,
  } = partitionMessages(messages, { protectActiveWindow: true, retainTokens });
  const groups = groupByTask(compressible);
  const taskBlocks: string[] = [];
  const summaryLines: string[] = [];
  const perTaskOriginals = new Map<string, MaouMessage[]>();
  const perTaskSummaries = new Map<string, string>();

  for (const [taskId, msgs] of groups) {
    perTaskOriginals.set(taskId, msgs);
    const taskSummaryText = summarizeTaskFallback(taskId, msgs).summary;
    perTaskSummaries.set(taskId, taskSummaryText);
    summaryLines.push(taskSummaryText);
    taskBlocks.push(taskId);
  }

  const summary = summaryLines.join("\n\n");
  // sync 版不筛选 activeTaskIds（maybeCompress 旧路径）
  const taskSummaryMsgs = taskBlocks.map((taskId) =>
    makeTaskSummaryMessage(taskId, perTaskSummaries.get(taskId)!, groups.get(taskId)!),
  );
  const result: MaouMessage[] = [
    ...systemMsgs,
    ...pinnedOrCritical,
    ...taskSummaryMsgs,
    ...recentToolMsgs,
    ...activeRawMsgs,
  ];

  return {
    messages: result.sort((a, b) => a.seqId - b.seqId),
    summary: buildDroppedSummary(compressible, summary),
    taskBlocks,
    perTaskOriginals,
    perTaskSummaries,
    activeRawMsgs,
  };
}

/**
 * 分区。protectActiveWindow=true（默认大压缩）时：
 * 与 micro 同一 active 边界内的非 system 消息 → activeRawMsgs（原文保留）。
 */
function partitionMessages(
  messages: MaouMessage[],
  opts?: { protectActiveWindow?: boolean; retainTokens?: number },
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
    if (m.pinned || m.keepAfterCompress) {
      // 已是 task_summary 等 keep 消息：若落在 active 区仍算 pin 集合，避免重复进 activeRaw
      pinnedOrCritical.push(m);
      continue;
    }
    // DESIGN active 原文区：整段保留，不进 task 摘要池
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

function archiveCompressHarness(input: SummaryCompressResult): { messages: MaouMessage[]; summary: string; taskBlocks: string[] } {
  const systemMsgs = input.messages.filter((m) => m.category === "system");
  // pin / task_summary 等；但不要把 active 原文误标成 pin 再丢
  const pinned = input.messages.filter(
    (m) =>
      (m.pinned || m.keepAfterCompress) &&
      !input.activeRawMsgs.some((a) => a.seqId === m.seqId),
  );
  // #1：旧侧 → 任务极简清单；DESIGN：active 原文区仍保留
  const archiveLines: string[] = [`[已归档任务: ${input.taskBlocks.length} 个]`];
  for (const taskId of input.taskBlocks) {
    const summary = input.perTaskSummaries.get(taskId) ?? "";
    const snippet = summary.length > 120 ? summary.slice(0, 120) + "…" : summary;
    archiveLines.push(`- ${taskId}: ${snippet}`);
  }
  const archiveText = archiveLines.join("\n");
  return {
    messages: [
      ...systemMsgs,
      makeSummaryMessage(archiveText),
      ...pinned,
      ...input.activeRawMsgs,
    ].sort((a, b) => a.seqId - b.seqId),
    summary: archiveText,
    taskBlocks: input.taskBlocks,
  };
}

// ─── task_id 赋值（供 ContextEngine 调用） ──────────────────────────────────

export function assignTaskIds(messages: MaouMessage[]): MaouMessage[] {
  let currentTaskId = "";
  // 非真人 user 不应开新 task（empty_retry / todo_notice / bus 等）
  const NON_HUMAN_SOURCES = new Set([
    "hook",
    "injected",
    "empty_retry",
    "verification",
    "todo_notice",
    "message_bus",
    "terminal-notification",
    "runtime_control",
    "system_notice",
    "agent_message",
  ]);
  return messages.map(m => {
    const src = String(m.source ?? "");
    const isHumanUser =
      m.category === "user" &&
      !NON_HUMAN_SOURCES.has(src) &&
      src !== "compact";
    if (isHumanUser) {
      currentTaskId = `t${m.seqId}`;
    }
    if (!currentTaskId) return m;
    if (m.taskIds.length > 0) return m;
    return { ...m, taskIds: [currentTaskId] };
  });
}

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function groupByTask(messages: MaouMessage[]): Map<string, MaouMessage[]> {
  const groups = new Map<string, MaouMessage[]>();
  for (const m of messages) {
    if (m.taskIds.length === 0) {
      const arr = groups.get("__no_task__") ?? [];
      arr.push(m);
      groups.set("__no_task__", arr);
    } else {
      for (const tid of m.taskIds) {
        const arr = groups.get(tid) ?? [];
        arr.push(m);
        groups.set(tid, arr);
      }
    }
  }
  return groups;
}

function summarizeTaskFallback(taskId: string, msgs: MaouMessage[]): TaskSummary {
  const userInputs: string[] = [];
  const assistantResponses: string[] = [];
  let toolCallCount = 0;
  let toolResultCount = 0;

  for (const m of msgs) {
    const text = m.contents.map(c => c.text).join('\n');
    switch (m.category) {
      case "user": userInputs.push(truncate(text, 100)); break;
      case "assistant": assistantResponses.push(truncate(text, 150)); break;
      case "tool_call": toolCallCount++; break;
      case "tool_result": toolResultCount++; break;
    }
  }

  const parts: string[] = [];
  if (userInputs.length > 0) parts.push(`用户输入(${userInputs.length}): ${userInputs.slice(0, 3).join("; ")}`);
  if (assistantResponses.length > 0) parts.push(`助手回复(${assistantResponses.length}): ${assistantResponses.slice(0, 2).join("; ")}`);
  if (toolCallCount > 0) parts.push(`工具调用(${toolCallCount})`);
  if (toolResultCount > 0) parts.push(`工具结果(${toolResultCount})`);

  return {
    taskId,
    status: "done",
    startTime: msgs[0]?.createdAt ?? new Date().toISOString(),
    summary: truncate(`[${taskId}] ${parts.join(" | ")}`, SUMMARY_MAX_CHARS),
    goal: "",
    outline: msgs.slice(0, 10).map(m => `- [${m.category}] ${truncate(m.contents.map(c => c.text).join('\n'), 50)}`),
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
  if (taskSummary.trim()) lines.push("\n任务摘要：\n" + taskSummary);
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

function makeSummaryMessage(summary: string): MaouMessage {
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
function makeTaskSummaryMessage(taskId: string, summary: string, originalMsgs: MaouMessage[]): MaouMessage {
  const seqId = originalMsgs[0]?.seqId ?? -1;
  return {
    seqId,
    taskIds: [taskId],
    contents: [{
      text: `<task_summary task="${taskId}">\n${summary}\n</task_summary>`,
    }],
    keepAfterCompress: true,
    category: "injected",
    originalRole: "user",
  };
}

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
  const fullText = mmsg.contents.map(c => {
    if (c.microCompact?.enabled && c.microCompact.summary) return c.microCompact.summary;
    return c.text;
  }).join('\n');
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
  const compressedTokens = estimateTokens(maouOut);
  return {
    messages: rawOut, compressed: stage !== "activeStage", droppedSummary: summary,
    stage, originalTokens, compressedTokens, taskBlocks: taskBlocks.length > 0 ? taskBlocks : undefined,
  };
}

// ─── 对外透出 ────────────────────────────────────────────────────────────────

export type { CompressionStage, CompressionResult, TaskSummary };
export { estimateTokens, estimateTokensFromText } from "./token-estimate.js";
