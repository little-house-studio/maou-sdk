/**
 * HarnessSessionStore —— 管理 harness_session 的双份存储（当前上下文 + 压缩前备份）。
 *
 * 存储路径：
 *   <maouRoot>/sessions/<sessionId>/harness_session.json         —— 当前上下文
 *   <maouRoot>/sessions/<sessionId>/harness_session_backup.json   —— 压缩前备份
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import type { MaouMessage } from "./types/message.js";
import type { CompressionStage } from "./types/compression.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** HarnessSessionStore 配置选项 */
export interface HarnessSessionStoreOptions {
  /** maou 根目录，默认 ~/.maou */
  maouRoot?: string;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  // Node.js rename 在同一文件系统上是原子操作
  renameSync(tmp, filePath);
}

// ─── HarnessSessionStore ───────────────────────────────────────────────────

/**
 * HarnessSessionStore —— 管理 harness_session 的双份存储。
 *
 * 职责：
 * - 保存两份 harness_session（当前上下文 + 压缩前备份）
 * - 支持压缩前备份、回溯到备份
 */
export class HarnessSessionStore {
  private maouRoot: string;

  constructor(options?: HarnessSessionStoreOptions) {
    this.maouRoot = options?.maouRoot ?? join(process.env.HOME ?? "", ".maou");
  }

  // ── 路径计算 ──

  /** 会话目录 */
  private sessionDir(sessionId: string): string {
    return join(this.maouRoot, "sessions", sessionId);
  }

  /** 当前上下文文件路径 */
  private currentPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "harness_session.json");
  }

  /** 备份上下文文件路径 */
  private backupPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "harness_session_backup.json");
  }

  // ── 核心操作 ──

  /**
   * 保存当前上下文
   */
  saveCurrent(sessionId: string, context: MaouMessage[]): void {
    const filePath = this.currentPath(sessionId);
    const data = {
      sessionId,
      updatedAt: nowIso(),
      context,
    };
    atomicWriteJson(filePath, data);
  }

  /**
   * 压缩前备份 —— 将当前上下文复制到备份文件
   */
  backupBeforeCompress(sessionId: string): void {
    const current = this.getCurrent(sessionId);
    if (!current) {
      // 当前不存在，无需备份
      return;
    }
    const filePath = this.backupPath(sessionId);
    const data = {
      sessionId,
      updatedAt: nowIso(),
      context: current,
    };
    atomicWriteJson(filePath, data);
  }

  /**
   * 获取当前上下文
   */
  getCurrent(sessionId: string): MaouMessage[] | null {
    const filePath = this.currentPath(sessionId);
    try {
      if (!existsSync(filePath)) return null;
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as {
        sessionId: string;
        updatedAt: string;
        context: MaouMessage[];
      };
      return raw.context ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 获取备份上下文（用于回溯）
   */
  getBackup(sessionId: string): MaouMessage[] | null {
    const filePath = this.backupPath(sessionId);
    try {
      if (!existsSync(filePath)) return null;
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as {
        sessionId: string;
        updatedAt: string;
        context: MaouMessage[];
      };
      return raw.context ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 回溯到备份 —— 将备份恢复为当前上下文
   */
  rollbackToBackup(sessionId: string): boolean {
    const backup = this.getBackup(sessionId);
    if (!backup) {
      return false;
    }
    // 将备份写入当前文件
    const filePath = this.currentPath(sessionId);
    const data = {
      sessionId,
      updatedAt: nowIso(),
      context: backup,
    };
    atomicWriteJson(filePath, data);
    return true;
  }

  // ── 压缩区落盘 ──

  /**
   * 保存压缩产出的"压缩区"数据（独立于当前上下文）。
   * 每次压缩覆盖上一次；调用方应在压缩后第一时间写入。
   */
  saveCompressedZone(
    sessionId: string,
    zone: CompressionStage,
    summary: string,
    taskBlocks: string[],
  ): void {
    const filePath = join(this.sessionDir(sessionId), "compressed_zone.json");
    const data = {
      sessionId,
      zone,
      summary,
      taskBlocks,
      compressedAt: nowIso(),
    };
    atomicWriteJson(filePath, data);
  }

  /** 读取最近一次压缩区数据 */
  getCompressedZone(sessionId: string): {
    zone: CompressionStage;
    summary: string;
    taskBlocks: string[];
    compressedAt: string;
  } | null {
    const filePath = join(this.sessionDir(sessionId), "compressed_zone.json");
    try {
      if (!existsSync(filePath)) return null;
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as {
        zone: CompressionStage;
        summary: string;
        taskBlocks: string[];
        compressedAt: string;
      };
      return raw;
    } catch {
      return null;
    }
  }

  // ── 按消息 ID 回溯 ──

  /**
   * 按 seqId 回溯上下文：返回该 id 及之前的所有 MaouMessage。
   * 优先从备份读取（压缩前），找不到则回退到当前上下文。
   */
  getBySeqId(sessionId: string, seqId: number): MaouMessage[] | null {
    const backup = this.getBackup(sessionId);
    const current = this.getCurrent(sessionId);
    const source = backup ?? current;
    if (!source) return null;
    return source.filter((m) => m.seqId <= seqId);
  }

}
