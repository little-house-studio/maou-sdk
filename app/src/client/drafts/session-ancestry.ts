/**
 * 会话树投影：沿 parent 上走到根，crumbs = 根 → 当前。
 * 有 parentSessionId（或 id 里的 `::fork::`）即视为子会话，停在无父节点。
 */

export type SessionTreeNode = {
  id: string;
  title: string;
  parentSessionId?: string;
  lamp?: string;
  helperCount?: number;
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

export function indexSessionTree<T extends SessionTreeNode>(sessions: T[]): {
  byId: Map<string, T>;
  children: Map<string, T[]>;
} {
  const byId = new Map<string, T>();
  for (const s of sessions) byId.set(s.id, s);

  const children = new Map<string, T[]>();
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

/** 侧栏树每一列：竖线 / ├ / └ / 空。SessionList 读写。 */
export type SessionTreeGuide = "pipe" | "tee" | "elbow" | "blank";

export type SessionForestRow<T extends SessionTreeNode = SessionTreeNode> = {
  node: T;
  depth: number;
  guides: SessionTreeGuide[];
  childCount: number;
};

/** 一层孩子达到这个数，默认收起（当前会话祖先链除外）。 */
export const SESSION_TREE_COLLAPSE_MANY = 5;

/** 根在前，子跟在父后。无父或父不在表里的当根。 */
export function flattenSessionForest<T extends SessionTreeNode>(
  sessions: T[],
): SessionForestRow<T>[] {
  const { children } = indexSessionTree(sessions);
  const ids = new Set(sessions.map((s) => s.id));
  const roots = sessions.filter((s) => {
    const p = resolveParentId(s);
    return !p || !ids.has(p);
  });
  const out: SessionForestRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (node: T, depth: number, lastFlags: boolean[]) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const kids = children.get(node.id) ?? [];
    const guides: SessionTreeGuide[] = lastFlags.map((isLast, i) => {
      if (i === lastFlags.length - 1) return isLast ? "elbow" : "tee";
      return isLast ? "blank" : "pipe";
    });
    out.push({ node, depth, guides, childCount: kids.length });
    kids.forEach((child, i) => {
      walk(child, depth + 1, [...lastFlags, i === kids.length - 1]);
    });
  };
  for (const r of roots) walk(r, 0, []);
  return out;
}

export function sessionTitleMatches(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return title.toLowerCase().includes(q);
}

/** 命中项沿 parent 把祖先留下，过滤后树不断。 */
export function filterSessionsKeepingAncestors<T extends SessionTreeNode>(
  sessions: T[],
  keepNode: (node: T) => boolean,
): { kept: T[]; matchedIds: Set<string> } {
  const { byId } = indexSessionTree(sessions);
  const matchedIds = new Set<string>();
  const keep = new Set<string>();
  for (const s of sessions) {
    if (!keepNode(s)) continue;
    matchedIds.add(s.id);
    let cursor: string | undefined = s.id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      keep.add(cursor);
      const node = byId.get(cursor);
      cursor = node ? resolveParentId(node) : undefined;
    }
  }
  return {
    kept: sessions.filter((s) => keep.has(s.id)),
    matchedIds,
  };
}

export function ancestryIdSet(
  sessions: SessionTreeNode[],
  sessionId: string | null | undefined,
): Set<string> {
  return new Set(deriveAncestry(sessions, sessionId).map((n) => n.id));
}

export function defaultCollapsedSessionIds(
  sessions: SessionTreeNode[],
  activeId: string | null | undefined,
  many = SESSION_TREE_COLLAPSE_MANY,
): Set<string> {
  const { children } = indexSessionTree(sessions);
  const path = ancestryIdSet(sessions, activeId);
  const out = new Set<string>();
  for (const s of sessions) {
    const n = children.get(s.id)?.length ?? 0;
    if (n < many) continue;
    if (path.has(s.id)) continue;
    out.add(s.id);
  }
  return out;
}

export function resolveCollapsedSessionIds(
  sessions: SessionTreeNode[],
  activeId: string | null | undefined,
  userOpen: ReadonlySet<string>,
  userFold: ReadonlySet<string>,
  many = SESSION_TREE_COLLAPSE_MANY,
): Set<string> {
  const path = ancestryIdSet(sessions, activeId);
  const out = defaultCollapsedSessionIds(sessions, activeId, many);
  for (const id of userFold) out.add(id);
  for (const id of userOpen) out.delete(id);
  for (const id of path) out.delete(id);
  return out;
}

/** 收起节点的旁枝后代不画；当前路径上的孩子留下。 */
export function dropCollapsedDescendants<T extends SessionTreeNode>(
  sessions: T[],
  collapsed: ReadonlySet<string>,
  path: ReadonlySet<string>,
): T[] {
  const { children } = indexSessionTree(sessions);
  const hide = new Set<string>();
  const walkHide = (id: string) => {
    for (const c of children.get(id) ?? []) {
      if (path.has(c.id)) continue;
      hide.add(c.id);
      walkHide(c.id);
    }
  };
  for (const id of collapsed) walkHide(id);
  return sessions.filter((s) => !hide.has(s.id));
}

export type SessionRailProjection<T extends SessionTreeNode = SessionTreeNode> =
  {
    rows: SessionForestRow<T>[];
    matchedIds: Set<string>;
    filtering: boolean;
    collapsedIds: Set<string>;
  };

/** 侧栏用：搜索保住祖先，折叠保住当前路径，再展平成带枝的行。 */
export function projectSessionRail<T extends SessionTreeNode>(
  sessions: T[],
  opts: {
    query?: string;
    extraKeepIds?: ReadonlySet<string>;
    activeId?: string | null;
    userOpen?: ReadonlySet<string>;
    userFold?: ReadonlySet<string>;
    collapseMany?: number;
  } = {},
): SessionRailProjection<T> {
  const q = (opts.query ?? "").trim();
  const extra = opts.extraKeepIds ?? new Set<string>();
  const filtering = q.length > 0 || extra.size > 0;
  let matchedIds = new Set<string>();
  let scoped = sessions;
  if (filtering) {
    const ql = q.toLowerCase();
    const filtered = filterSessionsKeepingAncestors(sessions, (n) => {
      if (extra.has(n.id)) return true;
      if (!q) return false;
      return (
        sessionTitleMatches(n.title, q) || n.id.toLowerCase().includes(ql)
      );
    });
    scoped = filtered.kept;
    matchedIds = filtered.matchedIds;
  } else {
    for (const s of sessions) matchedIds.add(s.id);
  }

  const path = ancestryIdSet(sessions, opts.activeId);
  const collapsedIds = filtering
    ? new Set<string>()
    : resolveCollapsedSessionIds(
        scoped,
        opts.activeId,
        opts.userOpen ?? new Set(),
        opts.userFold ?? new Set(),
        opts.collapseMany ?? SESSION_TREE_COLLAPSE_MANY,
      );
  const visible = filtering
    ? scoped
    : dropCollapsedDescendants(scoped, collapsedIds, path);
  return {
    rows: flattenSessionForest(visible),
    matchedIds,
    filtering,
    collapsedIds,
  };
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
