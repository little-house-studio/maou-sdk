/**
 * 会话树投影：沿 parent 上走到根，crumbs = 根 → 当前。
 * 有 parentSessionId（或 id 里的 `::fork::`）即视为子会话，停在无父节点。
 */

export type SessionTreeNode = {
  id: string;
  title: string;
  parentSessionId?: string;
};

const FORK_MARK = "::fork::";

/** 显式 parent 优先；否则从 `${parent}::fork::${task}::${ts}` 回推。 */
export function inferParentSessionId(
  id: string,
  explicit?: string | null,
): string | undefined {
  if (explicit) return explicit;
  const idx = id.lastIndexOf(FORK_MARK);
  if (idx <= 0) return undefined;
  return id.slice(0, idx);
}

export function resolveParentId(node: SessionTreeNode): string | undefined {
  return inferParentSessionId(node.id, node.parentSessionId);
}

export function indexSessionTree(sessions: SessionTreeNode[]): {
  byId: Map<string, SessionTreeNode>;
  children: Map<string, SessionTreeNode[]>;
} {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) byId.set(s.id, s);

  const children = new Map<string, SessionTreeNode[]>();
  for (const s of sessions) {
    const parent = resolveParentId(s);
    if (!parent) continue;
    const list = children.get(parent);
    if (list) list.push(s);
    else children.set(parent, [s]);
  }
  return { byId, children };
}

/**
 * 从当前会话沿父链走到根（含当前、含根）。环则截断。
 * 缺摘要时仍留下 id，标题回退为 id。
 */
export function deriveAncestry(
  sessions: SessionTreeNode[],
  sessionId: string | null | undefined,
): SessionTreeNode[] {
  if (!sessionId) return [];
  const { byId } = indexSessionTree(sessions);
  const chain: SessionTreeNode[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = sessionId;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const summary = byId.get(cursor);
    const node: SessionTreeNode = summary ?? { id: cursor, title: cursor };
    chain.unshift(node);
    const parent = resolveParentId(node);
    if (!parent) break;
    cursor = parent;
  }
  return chain;
}

export function childrenOf(
  sessions: SessionTreeNode[],
  parentId: string,
): SessionTreeNode[] {
  return indexSessionTree(sessions).children.get(parentId) ?? [];
}

/** 含间接后代；不含自身。 */
export function descendantCount(
  sessions: SessionTreeNode[],
  rootId: string,
): number {
  const { children } = indexSessionTree(sessions);
  let n = 0;
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      n += 1;
      walk(child.id);
    }
  };
  walk(rootId);
  return n;
}

export type SessionForestRow = {
  node: SessionTreeNode;
  depth: number;
};

/** 根在前，子跟在父后。无父或父不在表里的当根。 */
export function flattenSessionForest(
  sessions: SessionTreeNode[],
): SessionForestRow[] {
  const { children } = indexSessionTree(sessions);
  const ids = new Set(sessions.map((s) => s.id));
  const roots = sessions.filter((s) => {
    const p = resolveParentId(s);
    return !p || !ids.has(p);
  });
  const out: SessionForestRow[] = [];
  const seen = new Set<string>();
  const walk = (node: SessionTreeNode, depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ node, depth });
    for (const child of children.get(node.id) ?? []) walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

export function equalAncestry(
  left: SessionTreeNode[],
  right: SessionTreeNode[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, i) =>
        item.id === right[i]?.id && item.title === right[i]?.title,
    )
  );
}
