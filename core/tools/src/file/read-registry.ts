/**
 * 已读文件登记表 —— 支撑"先读后改"安全语义。
 *
 * read 工具读取文件后登记 (sessionId, absPath)；edit/write 前查询。
 * 盲改（未读就改）时，工具会返回当前文件内容并提示"先读再改"，避免基于陈旧假设覆盖。
 *
 * 进程内、按 session 隔离；轻量 Map，无需持久化（会话级即可）。
 */

import { statSync } from "node:fs";

interface ReadRecord {
  /** 读取时的文件 mtimeMs，用于检测"读后被外部改动" */
  mtimeMs: number;
}

const registry = new Map<string, Map<string, ReadRecord>>();

function sessionMap(sessionId: string): Map<string, ReadRecord> {
  let m = registry.get(sessionId);
  if (!m) {
    m = new Map();
    registry.set(sessionId, m);
  }
  return m;
}

/** 登记一次成功读取。 */
export function markRead(sessionId: string, absPath: string): void {
  if (!sessionId || !absPath) return;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    /* 文件可能刚写入即读，忽略 */
  }
  sessionMap(sessionId).set(absPath, { mtimeMs });
}

/** 该文件在本 session 是否被读过。 */
export function wasRead(sessionId: string, absPath: string): boolean {
  return sessionMap(sessionId).has(absPath);
}

/**
 * 读后是否被外部改动（mtime 漂移）。未读过返回 false（交给 wasRead 处理）。
 * 用于"读过但磁盘已变"——同样应提示重新读取。
 */
export function isStaleSinceRead(sessionId: string, absPath: string): boolean {
  const rec = sessionMap(sessionId).get(absPath);
  if (!rec) return false;
  try {
    return statSync(absPath).mtimeMs !== rec.mtimeMs;
  } catch {
    return false;
  }
}

/** 写入/编辑后刷新登记（写完即视为已读最新内容）。 */
export function refreshRead(sessionId: string, absPath: string): void {
  markRead(sessionId, absPath);
}

/** 清理某 session 的登记（会话结束/清理时调用）。 */
export function clearReadRegistry(sessionId: string): void {
  registry.delete(sessionId);
}

// ── 覆写二次确认（避免「明确要覆盖」时死循环 read）────────────────

/** 因未读被拦下的 path → 允许下一次 write 直接覆写 */
const pendingOverwrite = new Map<string, Set<string>>();

function pendingSet(sessionId: string): Set<string> {
  let s = pendingOverwrite.get(sessionId);
  if (!s) {
    s = new Set();
    pendingOverwrite.set(sessionId, s);
  }
  return s;
}

/** 登记：本 session 下次对 path 的 write 可跳过先读（force 或二次尝试） */
export function markOverwritePending(sessionId: string, absPath: string): void {
  if (!sessionId || !absPath) return;
  pendingSet(sessionId).add(absPath);
}

export function consumeOverwritePending(sessionId: string, absPath: string): boolean {
  if (!sessionId || !absPath) return false;
  const s = pendingOverwrite.get(sessionId);
  if (!s?.has(absPath)) return false;
  s.delete(absPath);
  return true;
}

export function clearOverwritePending(sessionId: string): void {
  pendingOverwrite.delete(sessionId);
}
