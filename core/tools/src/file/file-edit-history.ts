/**
 * 本 session 已写过/改过哪些文件。
 * 只给 write_file / edit_file 的「先读后写」开豁免：同会话已经动过的路径不必再拦一次。
 * 进程内、按 session 隔离；不存 before 内容，也不提供回退。
 */

const edited = new Map<string, Set<string>>();

function sessionSet(sessionId: string): Set<string> {
  let set = edited.get(sessionId);
  if (!set) {
    set = new Set();
    edited.set(sessionId, set);
  }
  return set;
}

/** 本 session 是否对该 path 做过 edit/write。 */
export function wasEditedInSession(sessionId: string, absPath: string): boolean {
  if (!sessionId || !absPath) return false;
  return edited.get(sessionId)?.has(absPath) ?? false;
}

/** 登记一次文件编辑（atomicWrite 之前调用即可）。 */
export function record(sessionId: string, absPath: string): void {
  if (!sessionId || !absPath) return;
  sessionSet(sessionId).add(absPath);
}

/** 清理某 session 的编辑标记（会话结束/切换时调用）。 */
export function clearHistory(sessionId: string): void {
  edited.delete(sessionId);
}
