/**
 * ContextEngine —— 编排 seed + compress + persist + toLLMHistory。
 *
 * 把 HarnessSessionStore / 上下文模块接成闭环。任务语义走 extensions。
 * SessionStore 仍是完整 UI/审计轨迹，本引擎不改写它。
 */

import type { MaouMessage, LLMMessage } from "./types/message.js";
import { maouToLLMMessage, removedSeqRange, sessionToMaouMessage } from "./types/message.js";
import {
  applyRoundMicroCompact,
  stampMicroBirth,
  keepFrozenPrefix,
  holdAsPromptCache,
  resolveMicroCompactRounds,
  formatMicroUnlockPrefix,
  DEFAULT_MICRO_COMPACT_CATALOG,
  type MicroCompactCatalog,
  type MicroUnlockItem,
  type TraditionalMajorScheme,
} from "@little-house-studio/context-components";
import {
  isHarnessMetaAligned,
  sessionMessageFingerprint,
  type HarnessSessionStore,
  type HarnessWorkingSetMeta,
} from "./harness-session-store.js";
import type { Summarizer } from "./compressor.js";
import type { CompressionStage } from "./types/compression.js";
import { resolveContextModule, type ContextModule } from "./modules/index.js";
import {
  applyAfterCompress,
  applyAfterSync,
  applyFold,
  applyOnClearSession,
  type ContextSchemeExtension,
} from "./scheme-extension.js";

export interface ContextEngineOptions {
  sessionId: string;
  harnessStore: HarnessSessionStore;
  summarizer?: Summarizer;
  /** 压缩模块或 id，默认 staged */
  module?: ContextModule | string;
  /** 传给模块的配置；staged 默认一次压到占用对应阶段 */
  moduleConfig?: unknown;
  extensions?: ContextSchemeExtension[];
  /** 轮次微压缩时钟初值；缺省从 harness 读 */
  microTurn?: number;
  /** 工具名 → 微压缩策略。缺省阅读类 traditional_read */
  microCatalog?: MicroCompactCatalog;
  /** Agent 级微压缩轮次；该 Agent 所有微压功能共用。缺省 3 */
  microRounds?: number;
}

export interface CompressReport {
  stage: CompressionStage;
  originalTokens: number;
  compressedTokens: number;
  blockIds: string[];
  droppedSummary: string;
  /** 被这次压缩顶掉的 seqId 闭区间；没顶掉任何整条消息时缺省 */
  seqFrom?: number;
  seqTo?: number;
}

/** seedWorkingSet 结果：供 Runtime 决定是否用 harness 历史替代全量 session */
export interface SeedWorkingSetResult {
  /** 是否以 harness 已有工作集为基座（含压缩后复用） */
  fromHarness: boolean;
  /** 本轮从 session 新 append 的条数 */
  appended: number;
  /** 工作集是否可作为 LLM 历史（fromHarness 或本轮刚压过） */
  useAsLlmHistory: boolean;
}

export class ContextEngine {
  readonly sessionId: string;
  private harnessStore: HarnessSessionStore;
  private summarizer?: Summarizer;
  private module: ContextModule;
  private moduleConfig: unknown;
  private extensions: ContextSchemeExtension[];
  private history: MaouMessage[] = [];
  private nextSeqId = 0;
  private lastCompressReport: CompressReport | null = null;
  /** 与 SessionStore 对齐：已覆盖的 messages 前缀长度 + 尾指纹 */
  private sourceSessionMessageCount = 0;
  private sourceTailFingerprint = "";
  private absorbedSeq = 0;
  /** 本轮 seed 是否来自 harness */
  private seededFromHarness = false;
  private microTurn = 0;
  private microCatalog: MicroCompactCatalog;
  private microRounds: number;
  private unlockHint: { atTurn: number; items: MicroUnlockItem[] } | null = null;

  constructor(opts: ContextEngineOptions) {
    this.sessionId = opts.sessionId;
    this.harnessStore = opts.harnessStore;
    this.summarizer = opts.summarizer;
    this.extensions = opts.extensions ?? [];
    this.module =
      typeof opts.module === "object" && opts.module
        ? opts.module
        : resolveContextModule(typeof opts.module === "string" ? opts.module : "staged");
    const defaults =
      this.module.defaultConfig && typeof this.module.defaultConfig === "object"
        ? this.module.defaultConfig
        : {};
    const extra = opts.moduleConfig && typeof opts.moduleConfig === "object" ? opts.moduleConfig : {};
    this.moduleConfig = { ...defaults, ...extra };
    this.microCatalog = opts.microCatalog ?? DEFAULT_MICRO_COMPACT_CATALOG;
    this.microTurn = opts.microTurn ?? 0;
    this.microRounds = resolveMicroCompactRounds(opts.microRounds);
  }

  /**
   * 从 HarnessSessionStore 加载已有上下文（冷启动 / 恢复会话）。
   * 若 store 里没有，返回空——调用方应从 SessionStore.loadMaouMessages 初始化。
   */
  load(): MaouMessage[] {
    const record = this.harnessStore.getCurrentRecord(this.sessionId);
    if (record && record.context.length > 0) {
      this.history = record.context;
      this.nextSeqId = Math.max(...record.context.map((m) => m.seqId), -1) + 1;
      this.sourceSessionMessageCount = record.sourceSessionMessageCount;
      this.sourceTailFingerprint = record.sourceTailFingerprint ?? "";
      this.absorbedSeq = record.absorbedSeq ?? 0;
      this.seededFromHarness = true;
      if (typeof record.microTurn === "number") this.microTurn = record.microTurn;
      if (record.microUnlockHint?.items?.length) this.unlockHint = record.microUnlockHint;
    }
    return this.history;
  }

  /**
   * 从原始 SessionMessage 数组初始化（旧会话首次进入引擎 / harness 不可用）。
   * 不写入 harness——全量 session 不必落成工作集，等真正压缩后再 persist。
   */
  initFromSessionMessages(sessionMessages: Array<Record<string, unknown>>): MaouMessage[] {
    this.history = sessionMessages.map((sm, idx) =>
      sessionToMaouMessage(sm as Parameters<typeof sessionToMaouMessage>[0], idx),
    );
    const beforeInit = this.snapshotHeld(this.history);
    this.history = this.protectFrozen(applyAfterSync(this.history, this.extensions), beforeInit);
    this.nextSeqId =
      this.history.length > 0
        ? Math.max(...this.history.map((m) => m.seqId)) + 1
        : 0;
    this.markSourceCoverage(sessionMessages);
    this.seededFromHarness = false;
    this.stampHistory();
    return this.history;
  }

  /**
   * B1 主入口：构建本轮 LLM 工作集。
   *
   * 1. harness 有对齐 meta 且尾指纹匹配 → 加载 harness，append session 增量
   * 2. 否则 → 从完整 session 初始化（不写 harness）
   * 3. 有增量 append 时写回 harness，避免下轮重复 append
   */
  seedWorkingSet(
    sessionMessages: Array<Record<string, unknown>>,
  ): SeedWorkingSetResult {
    const record = this.harnessStore.getCurrentRecord(this.sessionId);
    const meta: HarnessWorkingSetMeta | null = record
      ? {
          sourceSessionMessageCount: record.sourceSessionMessageCount,
          sourceTailFingerprint: record.sourceTailFingerprint,
          absorbedSeq: record.absorbedSeq,
        }
      : null;
    const aligned =
      !!record &&
      record.context.length > 0 &&
      isHarnessMetaAligned(meta, sessionMessages);

    if (aligned && record) {
      this.history = record.context.map((m) => ({ ...m, contents: [...m.contents] }));
      this.nextSeqId =
        this.history.length > 0
          ? Math.max(...this.history.map((m) => m.seqId)) + 1
          : 0;
      this.seededFromHarness = true;
      if (typeof record.microTurn === "number") this.microTurn = record.microTurn;
      if (record.microUnlockHint?.items?.length) this.unlockHint = record.microUnlockHint;

      const start = Math.max(0, record.sourceSessionMessageCount);
      const delta = sessionMessages.slice(start);
      let appended = 0;
      if (delta.length > 0) {
        const newMsgs = delta.map((sm, i) =>
          sessionToMaouMessage(
            sm as Parameters<typeof sessionToMaouMessage>[0],
            this.nextSeqId + i,
          ),
        );
        this.sync(newMsgs);
        appended = newMsgs.length;
      }
      this.markSourceCoverage(sessionMessages);
      // 有增量或 harness 缺指纹时，把对齐 meta 写回去
      if (appended > 0 || !record.sourceTailFingerprint) {
        this.persistWorkingSet();
      }
      return {
        fromHarness: true,
        appended,
        useAsLlmHistory: true,
      };
    }

    // harness 缺失 / 不对齐 → 全量 session（多模态旁路保留到未压缩前）
    this.initFromSessionMessages(sessionMessages);
    return {
      fromHarness: false,
      appended: 0,
      useAsLlmHistory: false,
    };
  }

  /**
   * 同步新增消息到工作上下文。
   * 给消息分配 seqId，然后跑 afterSync 扩展。
   */
  sync(newMessages: MaouMessage[]): void {
    for (const m of newMessages) {
      m.seqId = this.nextSeqId++;
    }
    this.history.push(...newMessages);
    for (const m of newMessages) {
      stampMicroBirth(m, this.microTurn, this.microCatalog, this.history, this.microRounds);
    }
    const beforeSync = this.snapshotHeld(this.history);
    this.history = this.protectFrozen(applyAfterSync(this.history, this.extensions), beforeSync);
  }

  getMicroTurn(): number {
    return this.microTurn;
  }

  getMicroRounds(): number {
    return this.microRounds;
  }

  /** 用户又说话（本 run 第一条，且此前已有时钟） */
  noteUserMicroTurn(): number {
    this.microTurn += 1;
    return this.microTurn;
  }

  /** 本轮 AI 开口 */
  beginAgentMicroTurn(): number {
    this.microTurn += 1;
    this.stampHistory();
    return this.microTurn;
  }

  /** 本轮 AI 结束后：到期的阅读结果等按策略微压 */
  applyRoundMicroCompact(): boolean {
    const out = applyRoundMicroCompact(this.history, this.microTurn, this.microCatalog, this.microRounds);
    if (out.unlockItems.length > 0) {
      this.unlockHint = { atTurn: this.microTurn + 1, items: out.unlockItems };
    }
    if (!out.changed) {
      this.persistClock();
      return false;
    }
    this.history = out.history;
    this.persistWorkingSet();
    return true;
  }

  private stampHistory(): void {
    if (this.microTurn <= 0) return;
    const hold = this.cacheHold();
    for (const m of this.history) {
      if (holdAsPromptCache(m, hold)) continue;
      stampMicroBirth(m, this.microTurn, this.microCatalog, this.history, this.microRounds);
    }
  }

  private cacheHold() {
    return { currentTurn: this.microTurn, catalog: this.microCatalog, limitRounds: this.microRounds };
  }

  private protectFrozen(after: MaouMessage[], before: MaouMessage[]): MaouMessage[] {
    return keepFrozenPrefix(before, after, this.cacheHold());
  }

  private snapshotHeld(history: MaouMessage[]): MaouMessage[] {
    const hold = this.cacheHold();
    return history.map((m) => {
      if (!holdAsPromptCache(m, hold)) return m;
      return {
        ...m,
        contents: m.contents.map((c) => ({
          ...c,
          attributes: c.attributes ? { ...c.attributes } : undefined,
          annotations: c.annotations ? { ...c.annotations } : undefined,
          microCompact: c.microCompact ? { ...c.microCompact } : undefined,
        })),
        toolCalls: m.toolCalls?.map((t) => ({ ...t })),
      };
    });
  }

  private persistClock(): void {
    if (this.seededFromHarness) this.persistWorkingSet();
  }

  /**
   * 标记当前工作集已覆盖的 session 前缀。
   * 压缩 / append 后调用，供 persistWorkingSet 写入 harness。
   */
  markSourceCoverage(sessionMessages: Array<Record<string, unknown>>): void {
    this.sourceSessionMessageCount = sessionMessages.length;
    const last = sessionMessages[sessionMessages.length - 1];
    this.sourceTailFingerprint = sessionMessageFingerprint(last);
    this.absorbedSeq = typeof last?.seq === "number" ? last.seq : sessionMessages.length;
  }

  /**
   * 执行压缩。备份 → 模块压 → 扩展 afterCompress → 写 harness。
   */
  async compress(
    maxTokens: number,
    opts?: {
      knownTokens?: number;
      force?: boolean;
      sourceSessionMessages?: Array<Record<string, unknown>>;
    },
  ): Promise<CompressReport> {
    const beforeCompress = this.snapshotHeld(this.history);
    const result = await this.module.compress({
      history: this.history,
      maxTokens,
      summarizer: this.summarizer,
      sessionId: this.sessionId,
      currentStage: this.lastCompressReport?.stage ?? "activeStage",
      force: opts?.force,
      knownTokens: opts?.knownTokens,
      fold: (ctx) => applyFold(ctx, this.extensions),
      config: this.moduleConfig,
      microTurn: this.microTurn,
      microCatalog: this.microCatalog,
      microRounds: this.microRounds,
      sessionRoot: this.harnessStore.sessionRoot(this.sessionId),
      majorScheme:
        this.moduleConfig &&
        typeof this.moduleConfig === "object" &&
        "majorScheme" in this.moduleConfig
          ? (this.moduleConfig as { majorScheme?: TraditionalMajorScheme }).majorScheme
          : undefined,
    });

    applyAfterCompress(
      {
        sessionId: this.sessionId,
        history: result.history,
        stage: result.stage,
        foldedOriginals: result.foldedOriginals,
        blockIds: result.blockIds,
      },
      this.extensions,
    );

    const beforeHistory = this.history;
    const removed = removedSeqRange(beforeHistory, result.history);
    this.history = this.protectFrozen(result.history, beforeCompress);
    if (opts?.sourceSessionMessages) {
      this.markSourceCoverage(opts.sourceSessionMessages);
    }
    if (result.compressed) {
      this.harnessStore.backupBeforeCompress(this.sessionId, beforeHistory);
      this.seededFromHarness = true;
      this.persistWorkingSet();
    } else if (this.seededFromHarness) {
      this.persistWorkingSet();
    }

    if (result.compressed && result.stage !== "activeStage") {
      this.harnessStore.saveCompressedZone(
        this.sessionId,
        result.stage,
        result.droppedSummary,
        result.blockIds,
      );
    }

    this.lastCompressReport = {
      stage: result.stage,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      blockIds: result.blockIds,
      droppedSummary: result.droppedSummary,
      ...(removed ? { seqFrom: removed.start, seqTo: removed.end } : {}),
    };

    return this.lastCompressReport;
  }

  /**
   * 将当前工作上下文转为 LLMMessage[]，供 buildMessages 使用。
   */
  toLLMHistory(): LLMMessage[] {
    const msgs = this.history.map(maouToLLMMessage);
    const prefix = this.unlockPrefixIfDue();
    if (prefix) msgs.push({ role: "user", content: prefix });
    return msgs;
  }

  /** 下一轮动态尾上的解锁提示；不到点或已过点则为空。 */
  unlockPrefixIfDue(): string {
    if (!this.unlockHint || this.microTurn !== this.unlockHint.atTurn) return "";
    return formatMicroUnlockPrefix(this.unlockHint.items);
  }

  /**
   * 获取当前工作上下文（MaouMessage[]）。
   */
  getHistory(): MaouMessage[] {
    return this.history;
  }

  /** 本轮是否以 harness 为基座 */
  isFromHarness(): boolean {
    return this.seededFromHarness;
  }

  /**
   * 获取最近一次压缩报告。
   */
  getLastCompressReport(): CompressReport | null {
    return this.lastCompressReport;
  }

  /**
   * 获取 droppedSummary（供注入到 buildMessages 的 compressedSummary 槽位）。
   */
  getDroppedSummary(): string {
    return this.lastCompressReport?.droppedSummary ?? "";
  }

  clearSessionExtras(): void {
    applyOnClearSession(this.sessionId, this.extensions);
  }

  /**
   * 按 seqId 回溯上下文。
   */
  getBySeqId(seqId: number): MaouMessage[] | null {
    return this.harnessStore.getBySeqId(this.sessionId, seqId);
  }

  /**
   * 取回被摘要顶掉的那段原文（CompactMessage.seqRange / CompressReport.seqFrom..seqTo）。
   *
   * 读的是压缩前的全量备份；备份不在了就返回 null，而不是拿压缩后的历史充数。
   */
  getCompactedRange(from: number, to: number): MaouMessage[] | null {
    return this.harnessStore.getSeqRange(this.sessionId, from, to);
  }

  /**
   * 持久化当前工作上下文（含 session 对齐 meta）。
   */
  save(): void {
    this.persistWorkingSet();
  }

  private persistWorkingSet(): void {
    this.harnessStore.saveCurrent(this.sessionId, this.history, {
      sourceSessionMessageCount: this.sourceSessionMessageCount,
      sourceTailFingerprint: this.sourceTailFingerprint || undefined,
      absorbedSeq: this.absorbedSeq || undefined,
      microTurn: this.microTurn || undefined,
      microUnlockHint: this.unlockHint ?? undefined,
    });
  }
}
