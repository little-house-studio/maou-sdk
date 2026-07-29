/**
 * ContextEngine —— 编排 assignTaskIds + compress + persist + toLLMHistory。
 *
 * 把 HarnessSessionStore / TaskSessionStore / compressMaou 接成闭环：
 *   seedWorkingSet(session) → （可选）compress → persist → toLLMHistory
 *   restoreTask(taskId)  → 从 TaskSessionStore 恢复原文
 *   getBySeqId(seqId)    → 从 HarnessSessionStore 回溯
 *
 * B1：工作集优先从 harness 恢复，再 append SessionStore 增量；
 * 压缩结果写入 harness（含 sourceSessionMessageCount），下一轮不再从全量 session 重压。
 * SessionStore 仍是完整 UI/审计轨迹，本引擎不改写它。
 */

import type { MaouMessage, LLMMessage } from "./types/message.js";
import { maouToLLMMessage, sessionToMaouMessage } from "./types/message.js";
import {
  isHarnessMetaAligned,
  sessionMessageFingerprint,
  type HarnessSessionStore,
  type HarnessWorkingSetMeta,
} from "./harness-session-store.js";
import type { TaskSessionStore, MaouTaskBlock } from "./task-session-store.js";
import { compressMaou, assignTaskIds } from "./compressor.js";
import type { Summarizer, CompressMaouResult } from "./compressor.js";
import type { CompressionStage } from "./types/compression.js";

export interface ContextEngineOptions {
  sessionId: string;
  harnessStore: HarnessSessionStore;
  taskStore: TaskSessionStore;
  summarizer?: Summarizer;
}

export interface CompressReport {
  stage: CompressionStage;
  originalTokens: number;
  compressedTokens: number;
  taskBlocks: string[];
  droppedSummary: string;
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
  private taskStore: TaskSessionStore;
  private summarizer?: Summarizer;
  private history: MaouMessage[] = [];
  private nextSeqId = 0;
  private lastCompressReport: CompressReport | null = null;
  /** 与 SessionStore 对齐：已覆盖的 messages 前缀长度 + 尾指纹 */
  private sourceSessionMessageCount = 0;
  private sourceTailFingerprint = "";
  /** 本轮 seed 是否来自 harness */
  private seededFromHarness = false;

  constructor(opts: ContextEngineOptions) {
    this.sessionId = opts.sessionId;
    this.harnessStore = opts.harnessStore;
    this.taskStore = opts.taskStore;
    this.summarizer = opts.summarizer;
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
      this.seededFromHarness = true;
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
    this.history = assignTaskIds(this.history);
    this.nextSeqId =
      this.history.length > 0
        ? Math.max(...this.history.map((m) => m.seqId)) + 1
        : 0;
    this.markSourceCoverage(sessionMessages);
    this.seededFromHarness = false;
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
   * 给消息分配 seqId，然后 assignTaskIds。
   */
  sync(newMessages: MaouMessage[]): void {
    for (const m of newMessages) {
      m.seqId = this.nextSeqId++;
    }
    this.history.push(...newMessages);
    this.history = assignTaskIds(this.history);
  }

  /**
   * 标记当前工作集已覆盖的 session 前缀。
   * 压缩 / append 后调用，供 persistWorkingSet 写入 harness。
   */
  markSourceCoverage(sessionMessages: Array<Record<string, unknown>>): void {
    this.sourceSessionMessageCount = sessionMessages.length;
    const last = sessionMessages[sessionMessages.length - 1];
    this.sourceTailFingerprint = sessionMessageFingerprint(last);
  }

  /**
   * 执行压缩。
   * 备份 → compress → 落盘任务块原文 → 保存压缩后上下文（含对齐 meta）→ 写 compressed_zone。
   *
   * @param opts.sourceSessionMessages 若传入，压缩后用其更新 source 对齐（推荐 Runtime 总是传入）
   */
  async compress(
    maxTokens: number,
    opts?: {
      knownTokens?: number;
      force?: boolean;
      sourceSessionMessages?: Array<Record<string, unknown>>;
    },
  ): Promise<CompressReport> {
    // 1. 备份
    this.harnessStore.backupBeforeCompress(this.sessionId);

    // 1.5 收集当前活跃 todo 关联的 task 块 id（#4：压缩时屏蔽无关 task）
    // 只有未完成 todo 关联的 task 块摘要进压缩区，其他 task 屏蔽归档
    const planBefore = this.taskStore.loadTaskPlan(this.sessionId);
    const activeTaskIds: string[] = [];
    for (const todo of planBefore) {
      if (todo.status !== "completed") {
        for (const id of todo.relatedBlockIds ?? []) {
          if (!activeTaskIds.includes(id)) activeTaskIds.push(id);
        }
      }
    }

    // 2. 压缩（传入 activeTaskIds：只有 active task 摘要进压缩区）
    const result: CompressMaouResult = await compressMaou(this.history, {
      maxTokens,
      summarizer: this.summarizer,
      sessionId: this.sessionId,
      activeTaskIds: activeTaskIds.length > 0 ? activeTaskIds : undefined,
      knownTokens: opts?.knownTokens,
      force: opts?.force,
    });

    // 3. 将被折叠的任务块原文写入 TaskSessionStore
    const newBlockIds: string[] = [];
    for (const [taskId, originals] of result.perTaskOriginals) {
      if (taskId === "__no_task__") continue;
      const llmMsgs = originals.map(maouToLLMMessage);
      this.taskStore.createTaskBlock(this.sessionId, taskId, "", []);
      for (const msg of llmMsgs) {
        this.taskStore.appendMessage(this.sessionId, taskId, msg);
      }
      newBlockIds.push(taskId);
    }

    // 3.5 关联新 task 块到未完成 todo 的 relatedBlockIds
    // 系统自动追加，不依赖 AI 显式声明——压缩产生的 task 块属于当前活跃的 todo
    if (newBlockIds.length > 0) {
      const plan = this.taskStore.loadTaskPlan(this.sessionId);
      let changed = false;
      for (const todo of plan) {
        if (todo.status !== "completed") {
          const existing = new Set(todo.relatedBlockIds ?? []);
          const before = existing.size;
          for (const id of newBlockIds) existing.add(id);
          if (existing.size !== before) {
            todo.relatedBlockIds = [...existing];
            changed = true;
          }
        }
      }
      if (changed) this.taskStore.saveTaskPlan(this.sessionId, plan);
    }

    // 4. 保存压缩后上下文 + 对齐 meta（B1 关键）
    this.history = result.history;
    if (opts?.sourceSessionMessages) {
      this.markSourceCoverage(opts.sourceSessionMessages);
    }
    // 真正压缩后（或 force 后）工作集已与 session 分叉，必须落 harness 供下轮复用
    if (result.stage !== "activeStage" || opts?.force) {
      this.seededFromHarness = true;
      this.persistWorkingSet();
    } else if (this.seededFromHarness) {
      // 无实质压缩但仍在 harness 路径：保持对齐
      this.persistWorkingSet();
    }

    // 5. 写 compressedStage
    if (result.stage !== "activeStage") {
      this.harnessStore.saveCompressedZone(
        this.sessionId,
        result.stage,
        result.droppedSummary,
        result.taskBlocks,
      );
    }

    this.lastCompressReport = {
      stage: result.stage,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      taskBlocks: result.taskBlocks,
      droppedSummary: result.droppedSummary,
    };

    return this.lastCompressReport;
  }

  /**
   * 将当前工作上下文转为 LLMMessage[]，供 buildMessages 使用。
   */
  toLLMHistory(): LLMMessage[] {
    return this.history.map(maouToLLMMessage);
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

  /**
   * 恢复指定任务的原文（从 TaskSessionStore 读取）。
   */
  restoreTask(taskId: string): MaouTaskBlock | null {
    return this.taskStore.getTaskBlock(this.sessionId, taskId);
  }

  /**
   * 按 seqId 回溯上下文。
   */
  getBySeqId(seqId: number): MaouMessage[] | null {
    return this.harnessStore.getBySeqId(this.sessionId, seqId);
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
    });
  }
}
