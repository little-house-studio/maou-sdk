/**
 * 会话快照存储 —— checkpoint 创建、回滚、差异比较。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import type { SessionStore, SessionData, SessionMessage, SessionTrace } from "./session-store.js";
import type { CheckpointMeta, CheckpointDiff } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export class CheckpointStore {
  private sessionStore: SessionStore;

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  // ─── 快照目录 ──────────────────────────────────────────────────────────────

  private checkpointDir(sessionId: string): string {
    const dir = join(this.sessionStore.sessionDir, `${sessionId}.checkpoints`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ─── 创建快照 ──────────────────────────────────────────────────────────────

  /**
   * 创建会话快照
   */
  createCheckpoint(
    sessionId: string,
    label?: string,
    autoCheckpoint?: boolean,
    triggerReason?: string,
  ): CheckpointMeta {
    const session = this.sessionStore.load(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    const cpId = genId();
    const cpDir = this.checkpointDir(sessionId);
    const metaFile = join(cpDir, `${cpId}.meta.json`);
    const dataFile = join(cpDir, `${cpId}.jsonl`);

    // 元信息
    const meta: CheckpointMeta = {
      id: cpId,
      sessionId,
      label: label ?? `checkpoint_${session.messages.length}_msgs`,
      messageCount: session.messages.length,
      createdAt: nowIso(),
      autoCheckpoint: autoCheckpoint ?? false,
      triggerReason,
    };

    // 写入元信息
    writeFileSync(metaFile, JSON.stringify(meta, null, 2), "utf-8");

    // 写入数据：完整拷贝会话 JSONL
    const jsonlPath = this.sessionStore.jsonlPath(sessionId);
    if (existsSync(jsonlPath)) {
      copyFileSync(jsonlPath, dataFile);
    } else {
      // 如果没有 JSONL（空会话），创建空文件
      writeFileSync(dataFile, "", "utf-8");
    }

    return meta;
  }

  // ─── 回滚 ──────────────────────────────────────────────────────────────────

  /**
   * 回滚到指定快照
   */
  rollbackToCheckpoint(sessionId: string, checkpointId: string): SessionData {
    const cpDir = this.checkpointDir(sessionId);
    const metaFile = join(cpDir, `${checkpointId}.meta.json`);
    const dataFile = join(cpDir, `${checkpointId}.jsonl`);

    if (!existsSync(metaFile) || !existsSync(dataFile)) {
      throw new Error(`快照不存在: ${checkpointId}`);
    }

    // 恢复 JSONL
    const targetJsonl = this.sessionStore.jsonlPath(sessionId);
    copyFileSync(dataFile, targetJsonl);

    // 更新 meta 的 updated_at
    const sessionMeta = this.sessionStore.load(sessionId);
    if (sessionMeta) {
      // 重新读取以触发 meta 文件更新
      this.sessionStore.save(sessionMeta);
    }

    return this.sessionStore.load(sessionId) ?? this.sessionStore.create();
  }

  // ─── 差异 ──────────────────────────────────────────────────────────────────

  /**
   * 比较两个快照的差异
   */
  diffCheckpoints(sessionId: string, fromCheckpointId: string, toCheckpointId: string): CheckpointDiff {
    const from = this._loadCheckpointMessages(sessionId, fromCheckpointId);
    const to = this._loadCheckpointMessages(sessionId, toCheckpointId);

    return this._computeDiff(from, to);
  }

  /**
   * 比较快照与当前会话的差异
   */
  diffFromCheckpoint(sessionId: string, checkpointId: string): CheckpointDiff {
    const from = this._loadCheckpointMessages(sessionId, checkpointId);
    const session = this.sessionStore.load(sessionId);
    const to = session?.messages ?? [];

    return this._computeDiff(from, to);
  }

  // ─── 列表/删除 ─────────────────────────────────────────────────────────────

  /** 列出会话所有快照 */
  listCheckpoints(sessionId: string): CheckpointMeta[] {
    const cpDir = this.checkpointDir(sessionId);
    const files = readdirSync(cpDir).filter(f => f.endsWith(".meta.json"));

    const metas: CheckpointMeta[] = [];
    for (const f of files) {
      try {
        const meta = JSON.parse(readFileSync(join(cpDir, f), "utf-8")) as CheckpointMeta;
        metas.push(meta);
      } catch {
        continue;
      }
    }

    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 删除快照 */
  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    const cpDir = this.checkpointDir(sessionId);
    const metaFile = join(cpDir, `${checkpointId}.meta.json`);
    const dataFile = join(cpDir, `${checkpointId}.jsonl`);

    if (!existsSync(metaFile)) return false;

    unlinkSync(metaFile);
    if (existsSync(dataFile)) unlinkSync(dataFile);
    return true;
  }

  // ─── 自动快照触发 ──────────────────────────────────────────────────────────

  /** 判断是否需要自动快照 */
  shouldAutoCheckpoint(eventType: "tool_call" | "compression" | "round_start"): boolean {
    // 工具调用前总是快照（风险操作）
    if (eventType === "tool_call") return true;
    // 压缩前快照（可能丢失信息）
    if (eventType === "compression") return true;
    // 每 10 轮快照一次
    if (eventType === "round_start") return false;  // 暂不启用
    return false;
  }

  // ─── 内部 ──────────────────────────────────────────────────────────────────

  private _loadCheckpointMessages(sessionId: string, checkpointId: string): SessionMessage[] {
    const cpDir = this.checkpointDir(sessionId);
    const dataFile = join(cpDir, `${checkpointId}.jsonl`);

    if (!existsSync(dataFile)) return [];

    const lines = readFileSync(dataFile, "utf-8").split("\n");
    const messages: SessionMessage[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "message") {
          const { type: _, ...msg } = event;
          messages.push(msg);
        }
      } catch {
        continue;
      }
    }

    return messages;
  }

  private _computeDiff(from: SessionMessage[], to: SessionMessage[]): CheckpointDiff {
    // 用 createdAt + role 作为粗略匹配键
    const fromKeys = new Set(from.map(m => `${m.createdAt}|${m.role}`));
    const toKeys = new Set(to.map(m => `${m.createdAt}|${m.role}`));

    const added = to.filter(m => !fromKeys.has(`${m.createdAt}|${m.role}`));
    const removed = from.filter(m => !toKeys.has(`${m.createdAt}|${m.role}`));

    const snippets = added.slice(0, 10).map(m => {
      const content = String(m.content ?? "").trim();
      return content.length > 100 ? content.slice(0, 100) + "…" : content;
    });

    return {
      addedMessages: added.length,
      removedMessages: removed.length,
      addedTraces: 0,  // 不追踪 trace
      removedTraces: 0,
      messageSnippets: snippets,
    };
  }
}