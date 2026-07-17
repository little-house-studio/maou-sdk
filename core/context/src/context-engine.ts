/**
 * ContextEngine —— 编排 assignTaskIds + compress + persist + toLLMHistory。
 *
 * 把 HarnessSessionStore / TaskSessionStore / compressMaou 接成闭环：
 *   sync(新消息) → assignTaskIds → compress → persist → toLLMHistory
 *   restoreTask(taskId)  → 从 TaskSessionStore 恢复原文
 *   getBySeqId(seqId)    → 从 HarnessSessionStore 回溯
 */

import type { MaouMessage, LLMMessage } from "./types/message.js";
import { maouToLLMMessage, sessionToMaouMessage, maouToSessionMessage } from "./types/message.js";
import type { HarnessSessionStore } from "./harness-session-store.js";
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

export class ContextEngine {
  readonly sessionId: string;
  private harnessStore: HarnessSessionStore;
  private taskStore: TaskSessionStore;
  private summarizer?: Summarizer;
  private history: MaouMessage[] = [];
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
   * 若 store 里没有，返回空——调用方应从 SessionStore.loadMaouMessages 初始化。
   */
  load(): MaouMessage[] {
    const existing = this.harnessStore.getCurrent(this.sessionId);
    if (existing && existing.length > 0) {
      this.history = existing;
      this.nextSeqId = Math.max(...existing.map(m => m.seqId)) + 1;
    }
    return this.history;
  }

  /**
   * 从原始 SessionMessage 数组初始化（旧会话首次进入引擎）。
   */
  initFromSessionMessages(sessionMessages: Array<Record<string, unknown>>): MaouMessage[] {
    this.history = sessionMessages.map((sm, idx) => sessionToMaouMessage(sm as any, idx));
    this.history = assignTaskIds(this.history);
    this.nextSeqId = this.history.length;
    return this.history;
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
   * 执行压缩。
   * 备份 → compress → 落盘任务块原文 → 保存压缩后上下文 → 写 compressed_zone。
   */
  async compress(
    maxTokens: number,
    opts?: { knownTokens?: number; force?: boolean },
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

    // 4. 保存压缩后上下文
    this.history = result.history;
    this.harnessStore.saveCurrent(this.sessionId, this.history);

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
   * 持久化当前工作上下文（不压缩，仅保存）。
   * 适用于每轮结束时保存增量。
   */
  save(): void {
    this.harnessStore.saveCurrent(this.sessionId, this.history);
  }
}
