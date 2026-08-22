/**
 * 会话树：Pi（id + parentId + leaf）与 DSH（按 boundary fork）的投影。
 * 旧线性 jsonl 没有 id 时，按数组顺序当一条链表。
 */

export type SessionVisibility = "llm" | "ui" | "both";

export interface TreeFields {
  id?: string;
  parentId?: string | null;
  visibility?: SessionVisibility;
  customType?: string;
  label?: string;
}

export function newEntryId(): string {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isLlmVisible(msg: TreeFields): boolean {
  return msg.visibility !== "ui";
}

/** 内存补 id：不写盘。缺 parentId 时用上一条。 */
export function ensureEntryIds<T extends TreeFields>(messages: T[]): T[] {
  let prevId: string | undefined;
  return messages.map((m, i) => {
    if (m.id) {
      prevId = m.id;
      return m;
    }
    const id = `legacy_${i}`;
    const next = { ...m, id, parentId: m.parentId ?? prevId ?? null };
    prevId = id;
    return next;
  });
}

/**
 * 从 leaf 沿 parentId 走到根。
 * leaf 找不到或全无 id → 整段线性历史（旧会话）。
 */
export function selectBranch<T extends TreeFields>(messages: T[], leafId?: string | null): T[] {
  if (messages.length === 0) return [];
  const stamped = ensureEntryIds(messages);
  const byId = new Map<string, T>();
  for (const m of stamped) {
    if (m.id) byId.set(m.id, m);
  }
  if (!leafId || !byId.has(leafId)) {
    return stamped;
  }

  const path: T[] = [];
  const seen = new Set<string>();
  let cur: T | undefined = byId.get(leafId);
  while (cur?.id && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    const pid = cur.parentId;
    if (!pid) {
      const idx = stamped.findIndex((m) => m.id === cur!.id);
      const prefix = idx > 0 ? stamped.slice(0, idx).filter((m) => !seen.has(m.id ?? "")) : [];
      return [...prefix, ...path.reverse()];
    }
    cur = byId.get(pid);
  }
  return path.reverse();
}

export function filterLlmVisible<T extends TreeFields>(messages: T[]): T[] {
  return messages.filter(isLlmVisible);
}

/** 从根到指定条目的前缀（含该条），供 DSH 式 fork(boundary)。 */
export function prefixThrough<T extends TreeFields>(messages: T[], entryId: string): T[] {
  const branch = selectBranch(messages, entryId);
  const idx = branch.findIndex((m) => m.id === entryId);
  if (idx === -1) return [];
  return branch.slice(0, idx + 1);
}
