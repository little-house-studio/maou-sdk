/**
 * 文件编辑历史 —— 支撑「被影响文件的回退机制」。
 *
 * edit_file/write_file 在 atomicWrite 之前调 record() 存下 before 内容；
 * undo_edit 工具或外部回退逻辑调 undo() 写回 before 内容。
 *
 * 进程内、按 session 隔离；轻量 Map，无需持久化（会话级即可）。
 * 每 session 最多保留 MAX_RECORDS 条，超出丢弃最老的。
 *
 * @see DESIGN.md 第 28 行「被影响文件的回退机制（一些工具编辑过内容会产生 diff 标记）」
 */

import { readFileSync, existsSync, rmSync } from "node:fs";
import { atomicWrite } from "./atomic-write.js";

/** 单次文件编辑记录（diff 标记） */
export interface FileEditRecord {
  /** 绝对路径 */
  path: string;
  /** 编辑前内容（用于 undo 写回）。新建文件时为 null */
  before: string | null;
  /** 编辑后内容（用于展示 diff，不参与 undo） */
  after: string;
  /** 时间戳 */
  timestamp: string;
  /** 触发本次编辑的 tool_call_id（关联上下文消息回退） */
  toolCallId?: string;
  /** 触发工具名（edit_file / write_file） */
  toolName: string;
  /** 编辑类型：edit=替换 / create=新建 / overwrite=覆写 */
  action: "edit" | "create" | "overwrite";
}

const MAX_RECORDS_PER_SESSION = 50;
/** 单文件内容超过此阈值（字符）不存 before（防止内存爆炸），undo 时提示无法回退 */
const MAX_BEFORE_CHARS = 512 * 1024; // 512KB

const registry = new Map<string, FileEditRecord[]>();

function sessionList(sessionId: string): FileEditRecord[] {
  let list = registry.get(sessionId);
  if (!list) {
    list = [];
    registry.set(sessionId, list);
  }
  return list;
}

/**
 * 登记一次文件编辑（在 atomicWrite 之前调用）。
 *
 * @returns 登记的 record（含 diff 标记），失败返回 null
 */
export function record(
  sessionId: string,
  absPath: string,
  before: string | null,
  after: string,
  opts?: { toolCallId?: string; toolName: string; action: FileEditRecord["action"] },
): FileEditRecord | null {
  if (!sessionId || !absPath) return null;

  // 大文件不存 before（undo 不可逆，但记录仍在供查询）
  const storedBefore =
    before !== null && before.length > MAX_BEFORE_CHARS ? null : before;

  const rec: FileEditRecord = {
    path: absPath,
    before: storedBefore,
    after,
    timestamp: new Date().toISOString(),
    toolCallId: opts?.toolCallId,
    toolName: opts?.toolName ?? "unknown",
    action: opts?.action ?? "edit",
  };

  const list = sessionList(sessionId);
  list.push(rec);
  // 超出上限丢弃最老的
  if (list.length > MAX_RECORDS_PER_SESSION) {
    list.splice(0, list.length - MAX_RECORDS_PER_SESSION);
  }
  return rec;
}

/** 取最近一条编辑记录（可按路径过滤）。 */
export function lastEdit(
  sessionId: string,
  absPath?: string,
): FileEditRecord | null {
  const list = sessionList(sessionId);
  for (let i = list.length - 1; i >= 0; i--) {
    const rec = list[i];
    if (!absPath || rec.path === absPath) return rec;
  }
  return null;
}

/** 按 toolCallId 取编辑记录。 */
export function findByToolCallId(
  sessionId: string,
  toolCallId: string,
): FileEditRecord | null {
  const list = sessionList(sessionId);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].toolCallId === toolCallId) return list[i];
  }
  return null;
}

/** 列出某 session 的全部编辑记录（可按路径过滤）。 */
export function listEdits(
  sessionId: string,
  absPath?: string,
): FileEditRecord[] {
  const list = sessionList(sessionId);
  return absPath ? list.filter((r) => r.path === absPath) : [...list];
}

/**
 * 回退最近一次编辑（写回 before 内容）。
 *
 * - 新建文件（before=null 且 action=create）→ 删除文件
 * - before=null 但 action≠create（大文件未存 before）→ 返回失败
 * - 否则写回 before 内容
 *
 * @returns { ok, message } ok=true 表示回退成功
 */
export function undo(
  sessionId: string,
  absPath?: string,
): { ok: boolean; message: string; record?: FileEditRecord } {
  const rec = lastEdit(sessionId, absPath);
  if (!rec) {
    return { ok: false, message: "没有可回退的编辑记录" };
  }

  // 新建文件 → 删除
  if (rec.action === "create" && rec.before === null) {
    try {
      rmSync(rec.path, { force: true });
      removeRecord(sessionId, rec);
      return { ok: true, message: `已删除新建文件: ${rec.path}`, record: rec };
    } catch (err) {
      return { ok: false, message: `删除文件失败: ${err}` };
    }
  }

  // before 未存（大文件）→ 无法回退
  if (rec.before === null) {
    return {
      ok: false,
      message: `无法回退：编辑前的内容未被保存（文件过大或 before 缺失）。路径: ${rec.path}`,
      record: rec,
    };
  }

  // 写回 before
  try {
    atomicWrite(rec.path, rec.before);
    removeRecord(sessionId, rec);
    return { ok: true, message: `已回退: ${rec.path}（恢复到 ${rec.timestamp} 之前的状态）`, record: rec };
  } catch (err) {
    return { ok: false, message: `回退失败: ${err}` };
  }
}

/**
 * 按 toolCallId 回退（关联上下文消息回退）。
 */
export function undoByToolCallId(
  sessionId: string,
  toolCallId: string,
): { ok: boolean; message: string; record?: FileEditRecord } {
  const rec = findByToolCallId(sessionId, toolCallId);
  if (!rec) {
    return { ok: false, message: `未找到 toolCallId=${toolCallId} 对应的编辑记录` };
  }
  return undo(sessionId, rec.path);
}

/** 清理某 session 的全部编辑历史（会话结束/清理时调用）。 */
export function clearHistory(sessionId: string): void {
  registry.delete(sessionId);
}

// ── 内部 ──

function removeRecord(sessionId: string, rec: FileEditRecord): void {
  const list = registry.get(sessionId);
  if (!list) return;
  const idx = list.lastIndexOf(rec);
  if (idx >= 0) list.splice(idx, 1);
}

/**
 * 读取当前文件内容（用于 edit_file/write_file 在 record 时获取 before）。
 * 文件不存在返回 null（表示新建）。
 */
export function readBefore(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}
