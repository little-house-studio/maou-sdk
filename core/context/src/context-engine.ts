/**
 * ContextEngine —— 编排 assignTaskIds + compress + persist + toLLMHistory。
 *
 * 把 HarnessSessionStore / TaskSessionStore / compressHarness 接成闭环：
 *   sync(新消息) → assignTaskIds → compress → persist → toLLMHistory
 *   restoreTask(taskId)  → 从 TaskSessionStore 恢复原文
 *   getBySeqId(seqId)    → 从 HarnessSessionStore 回溯
 */

import type { HarnessMessage, LLMMessage } from "./types/message.js";
import { harnessToLLMMessage, sessionToHarnessMessage, harnessToSessionMessage } from "./types/message.js";
import type { HarnessSessionStore } from "./harness-session-store.js";
import type { TaskSessionStore, TaskBlock } from "./task-session-store.js";
import { compressHarness, assignTaskIds } from "./compressor.js";
import type { Summarizer, CompressHarnessResult } from "./compressor.js";
import type { CompressionZone } from "./types/compression.js";

export interface ContextEngineOptions {
  sessionId: string;
  harnessStore: HarnessSessionStore;
  taskStore: TaskSessionStore;
  summarizer?: Summarizer;
}

export interface CompressReport {
  zone: CompressionZone;
  originalTokens: number;
  compressedTokens: number;
  taskBlocks: string[];
  droppedSummary: string;
}

export class ContextEngine {
  readonly sessionId: string;
  private harnessStore: HarnessSessionStore;
  private taskStore: TaskSessionStore;
  private summarizer?: Summarizer;
  private history: HarnessMessage[] = [];
  private nextSeqId = 0;
  private lastCompressReport: CompressReport | null = null;

  constructor(opts: ContextEngineOptions) {
    this.sessionId = opts.sessionId;
    this.harnessStore = opts.harnessStore;
    this.taskStore = opts.taskStore;
    this.summarizer = opts.summarizer;
  }

  /**
   * 从 HarnessSessionStore 加载已有上下文（冷启动 / 恢复会话）。
   * 若 store 里没有，返回空——调用方应从 SessionStore.loadHarnessMessages 初始化。
   */
  load(): HarnessMessage[] {
    const existing = this.harnessStore.getCurrent(this.sessionId);
    if (existing && existing.length > 0) {
      this.history = existing;
      this.nextSeqId = Math.max(...existing.map(m => m.seq_id)) + 1;
    }
    return this.history;
  }

  /**
   * 从原始 SessionMessage 数组初始化（旧会话首次进入引擎）。
   */
  initFromSessionMessages(sessionMessages: Array<Record<string, unknown>>): HarnessMessage[] {
    this.history = sessionMessages.map((sm, idx) => sessionToHarnessMessage(sm as any, idx));
    this.history = assignTaskIds(this.history);
    this.nextSeqId = this.history.length;
    return this.history;
  }

  /**
   * 同步新增消息到工作上下文。
   * 给消息分配 seq_id，然后 assignTaskIds。
   */
  sync(newMessages: HarnessMessage[]): void {
    for (const m of newMessages) {
      m.seq_id = this.nextSeqId++;
    }
    this.history.push(...newMessages);
    this.history = assignTaskIds(this.history);
  }

  /**
   * 执行压缩。
   * 备份 → compress → 落盘任务块原文 → 保存压缩后上下文 → 写 compressed_zone。
   */
  async compress(maxTokens: number): Promise<CompressReport> {
    // 1. 备份
    this.harnessStore.backupBeforeCompress(this.sessionId);

    // 2. 压缩
    const result: CompressHarnessResult = await compressHarness(this.history, {
      maxTokens,
      summarizer: this.summarizer,
      sessionId: this.sessionId,
    });

    // 3. 将被折叠的任务块原文写入 TaskSessionStore
    for (const [taskId, originals] of result.perTaskOriginals) {
      if (taskId === "__no_task__") continue;
      const llmMsgs = originals.map(harnessToLLMMessage);
      this.taskStore.createTaskBlock(this.sessionId, taskId, "", []);
      for (const msg of llmMsgs) {
        this.taskStore.appendMessage(this.sessionId, taskId, msg);
      }
    }

    // 4. 保存压缩后上下文
    this.history = result.history;
    this.harnessStore.saveCurrent(this.sessionId, this.history);

    // 5. 写 compressed_zone
    if (result.zone !== "active_zone") {
      this.harnessStore.saveCompressedZone(
        this.sessionId,
        result.zone,
        result.droppedSummary,
        result.taskBlocks,
      );
    }

    this.lastCompressReport = {
      zone: result.zone,
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
    return this.history.map(harnessToLLMMessage);
  }

  /**
   * 获取当前工作上下文（HarnessMessage[]）。
   */
  getHistory(): HarnessMessage[] {
    return this.history;
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
  restoreTask(taskId: string): TaskBlock | null {
    return this.taskStore.getTaskBlock(this.sessionId, taskId);
  }

  /**
   * 按 seq_id 回溯上下文。
   */
  getBySeqId(seqId: number): HarnessMessage[] | null {
    return this.harnessStore.getBySeqId(this.sessionId, seqId);
  }

  /**
   * 持久化当前工作上下文（不压缩，仅保存）。
   * 适用于每轮结束时保存增量。
   */
  save(): void {
    this.harnessStore.saveCurrent(this.sessionId, this.history);
  }
}
