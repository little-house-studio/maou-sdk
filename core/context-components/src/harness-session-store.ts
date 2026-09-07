/**
 * HarnessSessionStore —— 管理 harness_session 的双份存储（当前上下文 + 压缩前备份）。
 *
 * 存储路径（与 SessionStore 同一会话目录）：
 *   <sessionsDir>/<sessionId>/harness.json
 *   <sessionsDir>/<sessionId>/harness.bak.json
 *
 * harness 是 **LLM 工作集**（可压缩）；SessionStore 是完整审计轨迹。
 * 对齐键：`absorbedSeq` + 尾指纹；`sourceSessionMessageCount` 仍写入供增量 slice。
 */

import {
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MaouMessage } from "./types/message.js";
import type { CompressionStage } from "./types/compression.js";
import type { MicroUnlockItem } from "./micro-compact.js";
import { durableAtomicWriteJson } from "./durable-write.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** HarnessSessionStore 配置选项 */
export interface HarnessSessionStoreOptions {
  /** maou 根目录，默认 ~/.maou；无 sessionsDir 时用 <maouRoot>/sessions */
  maouRoot?: string;
  /** 与 SessionStore.sessionDir 相同 */
  sessionsDir?: string;
}

/**
 * 工作集与 SessionStore 的对齐元数据。
 * - absorbedSeq：已吸收的最后一条事件逻辑序号
 * - sourceSessionMessageCount：已吸收的 session.messages 前缀长度
 * - sourceTailFingerprint：该前缀最后一条的指纹
 */
export interface HarnessWorkingSetMeta {
  absorbedSeq?: number;
  sourceSessionMessageCount: number;
  sourceTailFingerprint?: string;
  /** 轮次微压缩时钟 */
  microTurn?: number;
  /** 下一轮动态尾要挂的解锁提示；到点后不再出现 */
  microUnlockHint?: { atTurn: number; items: MicroUnlockItem[] };
}

export interface HarnessCurrentRecord extends HarnessWorkingSetMeta {
  sessionId: string;
  updatedAt: string;
  context: MaouMessage[];
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(filePath: string, data: unknown): void {
  durableAtomicWriteJson(filePath, data);
}

/**
 * Session 消息指纹：用于校验 harness 覆盖前缀是否仍与 session 对齐。
 * 不依赖不稳定 id，用 role + toolCallId + content 前缀。
 */
export function sessionMessageFingerprint(
  msg: Record<string, unknown> | null | undefined,
): string {
  if (!msg || typeof msg !== "object") return "";
  const role = String(msg.role ?? "");
  const tool = String(msg.toolCallId ?? msg.tool_call_id ?? "");
  const content = String(msg.content ?? "").slice(0, 120);
  return `${role}|${tool}|${content}`;
}

/**
 * harness 元数据是否仍可对当前 session 使用。
 * 无 meta / 越界 / 尾指纹不匹配 → 不可用，应回退全量 session。
 *
 * 旧 harness（无 fingerprint）不可增量 append：只在 count 恰好等于当前长度时复用；
 * 否则回退全量，最多多压一轮，避免把旧工作集与全量 session 错叠。
 */
export function isHarnessMetaAligned(
  meta: HarnessWorkingSetMeta | null | undefined,
  sessionMessages: Array<Record<string, unknown>>,
): boolean {
  if (!meta) return false;
  const n = meta.sourceSessionMessageCount;
  if (!Number.isFinite(n) || n < 0 || n > sessionMessages.length) return false;
  if (n === 0) {
    return sessionMessages.length === 0;
  }
  const tail = sessionMessages[n - 1];
  if (typeof meta.absorbedSeq === "number") {
    const tailSeq = tail && typeof tail.seq === "number" ? tail.seq : undefined;
    if (tailSeq != null && tailSeq !== meta.absorbedSeq) return false;
  }
  if (!meta.sourceTailFingerprint) {
    return n > 0 && n === sessionMessages.length;
  }
  return sessionMessageFingerprint(tail) === meta.sourceTailFingerprint;
}

// ─── HarnessSessionStore ───────────────────────────────────────────────────

/**
 * HarnessSessionStore —— 管理 harness_session 的双份存储。
 *
 * 职责：
 * - 保存两份 harness_session（当前上下文 + 压缩前备份）
 * - 支持压缩前备份、回溯到备份
 * - 记录与 SessionStore 的覆盖对齐信息（B1）
 */
export class HarnessSessionStore {
  private sessionsDir: string;

  constructor(options?: HarnessSessionStoreOptions) {
    const envHome = process.env.MAOU_HOME?.trim();
    const maouRoot = options?.maouRoot ?? (envHome ? envHome : join(homedir(), ".maou"));
    this.sessionsDir = options?.sessionsDir ?? join(maouRoot, "sessions");
  }

  sessionRoot(sessionId: string): string {
    return join(this.sessionsDir, sessionId);
  }

  private sessionDir(sessionId: string): string {
    return this.sessionRoot(sessionId);
  }

  private currentPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "harness.json");
  }

  private backupPath(sessionId: string): string {
    return join(this.sessionDir(sessionId), "harness.bak.json");
  }

  // ── 核心操作 ──

  /**
   * 保存当前上下文（可选对齐元数据）。
   */
  saveCurrent(
    sessionId: string,
    context: MaouMessage[],
    meta?: HarnessWorkingSetMeta,
  ): void {
    const filePath = this.currentPath(sessionId);
    const prev = this.getCurrentRecord(sessionId);
    const data: HarnessCurrentRecord = {
      sessionId,
      updatedAt: nowIso(),
      context,
      sourceSessionMessageCount:
        meta?.sourceSessionMessageCount ??
        prev?.sourceSessionMessageCount ??
        0,
      absorbedSeq: meta?.absorbedSeq ?? prev?.absorbedSeq,
      sourceTailFingerprint:
        meta?.sourceTailFingerprint ?? prev?.sourceTailFingerprint,
      microTurn: meta?.microTurn ?? prev?.microTurn,
      microUnlockHint: meta?.microUnlockHint ?? prev?.microUnlockHint,
    };
    atomicWriteJson(filePath, data);
  }

  /**
   * 压缩前备份 —— 将当前上下文复制到备份文件
   */
  /**
   * @param history 压缩前的内存历史。首次压缩时盘上还没有工作集，
   *   只读盘会备份到空，摘要的 seqRange 就指向不存在的原文。
   */
  backupBeforeCompress(sessionId: string, history?: MaouMessage[]): void {
    const current = this.getCurrentRecord(sessionId);
    const context = history ?? current?.context;
    if (!context || context.length === 0) {
      return;
    }
    const filePath = this.backupPath(sessionId);
    const data = {
      sessionId,
      updatedAt: nowIso(),
      context,
      sourceSessionMessageCount: current?.sourceSessionMessageCount,
      absorbedSeq: current?.absorbedSeq,
      sourceTailFingerprint: current?.sourceTailFingerprint,
    };
    atomicWriteJson(filePath, data);
  }

  /**
   * 读取完整当前记录（含对齐 meta）。
   */
  getCurrentRecord(sessionId: string): HarnessCurrentRecord | null {
    const filePath = this.currentPath(sessionId);
    try {
      if (!existsSync(filePath)) return null;
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<HarnessCurrentRecord>;
      if (!Array.isArray(raw.context)) return null;
      return {
        sessionId: String(raw.sessionId ?? sessionId),
        updatedAt: String(raw.updatedAt ?? ""),
        context: raw.context,
        sourceSessionMessageCount: Number(raw.sourceSessionMessageCount ?? 0) || 0,
        absorbedSeq: typeof raw.absorbedSeq === "number" ? raw.absorbedSeq : undefined,
        sourceTailFingerprint:
          typeof raw.sourceTailFingerprint === "string"
            ? raw.sourceTailFingerprint
            : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取当前上下文
   */
  getCurrent(sessionId: string): MaouMessage[] | null {
    return this.getCurrentRecord(sessionId)?.context ?? null;
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
    const filePath = this.backupPath(sessionId);
    try {
      if (!existsSync(filePath)) return false;
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<HarnessCurrentRecord>;
      if (!Array.isArray(raw.context)) return false;
      const currentPath = this.currentPath(sessionId);
      const data: HarnessCurrentRecord = {
        sessionId,
        updatedAt: nowIso(),
        context: raw.context,
        sourceSessionMessageCount: Number(raw.sourceSessionMessageCount ?? 0) || 0,
        absorbedSeq: typeof raw.absorbedSeq === "number" ? raw.absorbedSeq : undefined,
        sourceTailFingerprint:
          typeof raw.sourceTailFingerprint === "string"
            ? raw.sourceTailFingerprint
            : undefined,
      };
      atomicWriteJson(currentPath, data);
      return true;
    } catch {
      return false;
    }
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

  /**
   * 取 [from, to] 闭区间的原文。
   *
   * 只认压缩前的备份：当前上下文里这段已经被摘要顶掉了，拿它顶替等于假装能倒带。
   */
  getSeqRange(sessionId: string, from: number, to: number): MaouMessage[] | null {
    const backup = this.getBackup(sessionId);
    if (!backup) return null;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return backup.filter((m) => m.seqId >= lo && m.seqId <= hi);
  }
}
