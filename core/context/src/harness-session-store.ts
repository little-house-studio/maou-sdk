/**
 * HarnessSessionStore —— 管理 harness_session 的双份存储（当前上下文 + 压缩前备份）。
 *
 * 存储路径：
 *   <maouRoot>/sessions/<sessionId>/harness_session.json         —— 当前上下文
 *   <maouRoot>/sessions/<sessionId>/harness_session_backup.json   —— 压缩前备份
 *
 * harness 是 **LLM 工作集**（可压缩）；SessionStore 仍是完整审计轨迹（UI）。
 * `sourceSessionMessageCount` 记录本工作集已覆盖的 session.messages 条数，
 * 下轮只 append 增量，避免每轮从全量 session 重压（B1）。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MaouMessage } from "./types/message.js";
import type { CompressionStage } from "./types/compression.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** HarnessSessionStore 配置选项 */
export interface HarnessSessionStoreOptions {
  /** maou 根目录，默认 ~/.maou */
  maouRoot?: string;
}

/**
 * 工作集与 SessionStore 的对齐元数据。
 * - sourceSessionMessageCount：已吸收的 session.messages 前缀长度
 * - sourceTailFingerprint：该前缀最后一条的指纹（检测 /new 截断或重写）
 */
export interface HarnessWorkingSetMeta {
  sourceSessionMessageCount: number;
  sourceTailFingerprint?: string;
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
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  // Node.js rename 在同一文件系统上是原子操作
  renameSync(tmp, filePath);
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
  if (!meta.sourceTailFingerprint) {
    // 无指纹：无法校验前缀 → 仅「完整覆盖且无新消息」可复用
    return n > 0 && n === sessionMessages.length;
  }
  if (n === 0) {
    return sessionMessages.length === 0;
  }
  const tail = sessionMessages[n - 1];
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
  private maouRoot: string;

  constructor(options?: HarnessSessionStoreOptions) {
    // MAOU_HOME 即用户态根（已含 .maou）；未设时用 ~/ .maou
    const envHome = process.env.MAOU_HOME?.trim();
    this.maouRoot =
      options?.maouRoot ?? (envHome ? envHome : join(homedir(), ".maou"));
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
      sourceTailFingerprint:
        meta?.sourceTailFingerprint ?? prev?.sourceTailFingerprint,
    };
    atomicWriteJson(filePath, data);
  }

  /**
   * 压缩前备份 —— 将当前上下文复制到备份文件
   */
  backupBeforeCompress(sessionId: string): void {
    const current = this.getCurrentRecord(sessionId);
    if (!current) {
      return;
    }
    const filePath = this.backupPath(sessionId);
    const data = {
      sessionId,
      updatedAt: nowIso(),
      context: current.context,
      sourceSessionMessageCount: current.sourceSessionMessageCount,
      sourceTailFingerprint: current.sourceTailFingerprint,
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
}
