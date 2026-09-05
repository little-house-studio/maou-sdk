/**
 * Project Graph–aligned pure node graph for draft project canvas.
 *
 * Core mechanics (not full product parity):
 * - create text node
 * - select + move
 * - directed edge connect
 * - delete selection
 * - deep grow (Tab): child to the right of selected, edge parent→child
 * - broad grow (`\`): sibling under same parent when parent exists
 *
 * Ref: https://graphif.dev/docs/prg/features/feature/tree
 */

export type GraphNode = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
};

export type ProjectGraphState = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Single primary selection (Project Graph multi-select is non-goal). */
  selectedId: string | null;
  nextId: number;
};

export const NODE_W = 160;
export const NODE_H = 44;
export const GROW_GAP_X = 48;
export const GROW_GAP_Y = 24;

export function emptyGraph(): ProjectGraphState {
  return { nodes: [], edges: [], selectedId: null, nextId: 1 };
}

function cloneState(state: ProjectGraphState): ProjectGraphState {
  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    edges: state.edges.map((e) => ({ ...e })),
    selectedId: state.selectedId,
    nextId: state.nextId,
  };
}

function allocId(state: ProjectGraphState, prefix: string): {
  id: string;
  nextId: number;
} {
  const id = `${prefix}${state.nextId}`;
  return { id, nextId: state.nextId + 1 };
}

export function getNode(
  state: ProjectGraphState,
  id: string,
): GraphNode | undefined {
  return state.nodes.find((n) => n.id === id);
}

/** Parent = unique edge source that points at this node (tree parent). */
export function findParentId(
  state: ProjectGraphState,
  nodeId: string,
): string | null {
  const incoming = state.edges.filter((e) => e.to === nodeId);
  if (incoming.length !== 1) return null;
  return incoming[0]!.from;
}

export function childrenOf(
  state: ProjectGraphState,
  parentId: string,
): GraphNode[] {
  const childIds = new Set(
    state.edges.filter((e) => e.from === parentId).map((e) => e.to),
  );
  return state.nodes.filter((n) => childIds.has(n.id));
}

export function selectNode(
  state: ProjectGraphState,
  id: string | null,
): ProjectGraphState {
  if (id != null && !getNode(state, id)) return state;
  return { ...state, selectedId: id };
}

export function createTextNode(
  state: ProjectGraphState,
  opts: {
    text?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    select?: boolean;
  } = {},
): ProjectGraphState {
  const next = cloneState(state);
  const { id, nextId } = allocId(next, "n");
  next.nextId = nextId;
  const node: GraphNode = {
    id,
    text: opts.text ?? "新节点",
    x: opts.x ?? 80 + (next.nodes.length % 4) * 40,
    y: opts.y ?? 80 + next.nodes.length * 20,
    width: opts.width ?? NODE_W,
    height: opts.height ?? NODE_H,
  };
  next.nodes.push(node);
  if (opts.select !== false) next.selectedId = id;
  return next;
}

export function moveNode(
  state: ProjectGraphState,
  id: string,
  x: number,
  y: number,
): ProjectGraphState {
  const next = cloneState(state);
  const node = next.nodes.find((n) => n.id === id);
  if (!node) return state;
  node.x = x;
  node.y = y;
  return next;
}

/** Snap a node's x/y to a grid (default 8px). */
export function snapNodeToGrid(
  state: ProjectGraphState,
  id: string,
  grid = 8,
): ProjectGraphState {
  const node = getNode(state, id);
  if (!node || grid <= 0) return state;
  const x = Math.round(node.x / grid) * grid;
  const y = Math.round(node.y / grid) * grid;
  if (x === node.x && y === node.y) return state;
  return moveNode(state, id, x, y);
}

/** Snap every node to grid. */
export function snapGraphToGrid(
  state: ProjectGraphState,
  grid = 8,
): ProjectGraphState {
  if (grid <= 0 || state.nodes.length === 0) return state;
  let next = state;
  for (const n of state.nodes) {
    next = snapNodeToGrid(next, n.id, grid);
  }
  return next;
}

export function updateNodeText(
  state: ProjectGraphState,
  id: string,
  text: string,
): ProjectGraphState {
  const next = cloneState(state);
  const node = next.nodes.find((n) => n.id === id);
  if (!node) return state;
  node.text = text;
  return next;
}

/** Directed edge from → to. No self-loops; no duplicate edges. */
export function connectNodes(
  state: ProjectGraphState,
  fromId: string,
  toId: string,
): ProjectGraphState {
  if (fromId === toId) return state;
  if (!getNode(state, fromId) || !getNode(state, toId)) return state;
  if (state.edges.some((e) => e.from === fromId && e.to === toId)) {
    return state;
  }
  const next = cloneState(state);
  const { id, nextId } = allocId(next, "e");
  next.nextId = nextId;
  next.edges.push({ id, from: fromId, to: toId });
  return next;
}

/** Delete selected node and all incident edges. */
export function deleteSelection(state: ProjectGraphState): ProjectGraphState {
  const id = state.selectedId;
  if (!id) return state;
  if (!getNode(state, id)) return state;
  const next = cloneState(state);
  next.nodes = next.nodes.filter((n) => n.id !== id);
  next.edges = next.edges.filter((e) => e.from !== id && e.to !== id);
  next.selectedId = null;
  return next;
}

/** Remove a directed edge by id. */
export function deleteEdge(
  state: ProjectGraphState,
  edgeId: string,
): ProjectGraphState {
  if (!state.edges.some((e) => e.id === edgeId)) return state;
  const next = cloneState(state);
  next.edges = next.edges.filter((e) => e.id !== edgeId);
  return next;
}

/** Reverse edge direction (from↔to). Drops if reverse would create a self-loop or duplicate. */
export function reverseEdge(
  state: ProjectGraphState,
  edgeId: string,
): ProjectGraphState {
  const edge = state.edges.find((e) => e.id === edgeId);
  if (!edge) return state;
  if (edge.from === edge.to) return state;
  if (state.edges.some((e) => e.from === edge.to && e.to === edge.from)) {
    // reverse already exists — just delete this one
    return deleteEdge(state, edgeId);
  }
  const next = cloneState(state);
  const e = next.edges.find((x) => x.id === edgeId);
  if (!e) return state;
  const from = e.from;
  e.from = e.to;
  e.to = from;
  return next;
}

/** Duplicate selected node offset slightly (no edges copied). */
export function duplicateSelection(
  state: ProjectGraphState,
  offset = { x: 24, y: 24 },
): ProjectGraphState {
  const id = state.selectedId;
  if (!id) return state;
  const src = getNode(state, id);
  if (!src) return state;
  return createTextNode(state, {
    text: src.text,
    x: src.x + offset.x,
    y: src.y + offset.y,
    width: src.width,
    height: src.height,
    select: true,
  });
}

function placeChildOf(parent: GraphNode, siblings: GraphNode[]): {
  x: number;
  y: number;
} {
  const x = parent.x + parent.width + GROW_GAP_X;
  if (siblings.length === 0) {
    return { x, y: parent.y };
  }
  const bottom = Math.max(...siblings.map((s) => s.y + s.height));
  return { x, y: bottom + GROW_GAP_Y };
}

function placeSiblingOf(
  selected: GraphNode,
  parent: GraphNode,
  siblings: GraphNode[],
): { x: number; y: number } {
  // Project Graph default growth is right of parent; siblings stack vertically.
  const peers = siblings.filter((s) => s.id !== selected.id);
  const stack = [selected, ...peers];
  const bottom = Math.max(...stack.map((s) => s.y + s.height));
  return {
    x: parent.x + parent.width + GROW_GAP_X,
    y: Math.max(bottom + GROW_GAP_Y, selected.y + selected.height + GROW_GAP_Y),
  };
}

/**
 * 深度生长 (Tab): create child of selected, edge selected→new, place to the right.
 */
export function deepGrow(
  state: ProjectGraphState,
  text = "子节点",
): ProjectGraphState {
  const selectedId = state.selectedId;
  if (!selectedId) return state;
  const parent = getNode(state, selectedId);
  if (!parent) return state;
  const siblings = childrenOf(state, selectedId);
  const pos = placeChildOf(parent, siblings);
  let next = createTextNode(state, {
    text,
    x: pos.x,
    y: pos.y,
    select: true,
  });
  const newId = next.selectedId!;
  next = connectNodes(next, selectedId, newId);
  next = selectNode(next, newId);
  return next;
}

/**
 * 广度生长 (`\`): create sibling under same parent when parent exists.
 * Isolated nodes (no single parent) cannot broad-grow.
 */
export function broadGrow(
  state: ProjectGraphState,
  text = "同级节点",
): ProjectGraphState {
  const selectedId = state.selectedId;
  if (!selectedId) return state;
  const selected = getNode(state, selectedId);
  if (!selected) return state;
  const parentId = findParentId(state, selectedId);
  if (!parentId) return state;
  const parent = getNode(state, parentId);
  if (!parent) return state;
  const siblings = childrenOf(state, parentId);
  const pos = placeSiblingOf(selected, parent, siblings);
  let next = createTextNode(state, {
    text,
    x: pos.x,
    y: pos.y,
    select: true,
  });
  const newId = next.selectedId!;
  next = connectNodes(next, parentId, newId);
  next = selectNode(next, newId);
  return next;
}

export type OutlineSeedItem = {
  level: number;
  title: string;
};

/**
 * Build a simple rightward tree from ATX outline levels (heading hierarchy).
 */
export function graphFromOutline(
  items: OutlineSeedItem[],
  origin: { x: number; y: number } = { x: 48, y: 48 },
): ProjectGraphState {
  let state = emptyGraph();
  if (items.length === 0) {
    return createTextNode(state, {
      text: "根节点",
      x: origin.x,
      y: origin.y,
    });
  }

  /** stack of { level, id } for open parents */
  const stack: { level: number; id: string }[] = [];
  /** per-parent child count for vertical packing */
  const childCount = new Map<string | null, number>();

  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= item.level) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1]! : null;
    const parentKey = parent?.id ?? null;
    const idx = childCount.get(parentKey) ?? 0;
    childCount.set(parentKey, idx + 1);

    const depth = stack.length;
    const x = origin.x + depth * (NODE_W + GROW_GAP_X);
    const y = origin.y + idx * (NODE_H + GROW_GAP_Y);

    state = createTextNode(state, {
      text: item.title,
      x,
      y,
      select: false,
    });
    const newId = state.nodes[state.nodes.length - 1]!.id;
    if (parent) {
      state = connectNodes(state, parent.id, newId);
    }
    stack.push({ level: item.level, id: newId });
  }

  if (state.nodes.length > 0) {
    state = selectNode(state, state.nodes[0]!.id);
  }
  return state;
}

/** Snapshot equality helper for tests / dirty checks on graph. */
export function graphFingerprint(state: ProjectGraphState): string {
  const nodes = [...state.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => `${n.id}:${n.text}@${Math.round(n.x)},${Math.round(n.y)}`);
  const edges = [...state.edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => `${e.from}->${e.to}`);
  return `${nodes.join("|")}#${edges.join("|")}`;
}

/** Exact title match for outline → canvas selection (first match). */
export function findNodeIdByText(
  state: ProjectGraphState,
  text: string,
): string | null {
  const hit = state.nodes.find((n) => n.text === text);
  return hit?.id ?? null;
}

/** Axis-aligned bounds of all nodes (empty graph → null). */
export function graphBounds(
  state: ProjectGraphState,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (state.nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of state.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { minX, minY, maxX, maxY };
}

export function cloneGraph(state: ProjectGraphState): ProjectGraphState {
  return {
    nodes: state.nodes.map((n) => ({ ...n })),
    edges: state.edges.map((e) => ({ ...e })),
    selectedId: state.selectedId,
    nextId: state.nextId,
  };
}

export type GraphHistory = {
  past: ProjectGraphState[];
  present: ProjectGraphState;
  future: ProjectGraphState[];
};

export function historyInit(present: ProjectGraphState): GraphHistory {
  return { past: [], present: cloneGraph(present), future: [] };
}

/** Push present→past when structure/text/layout changes (max depth). */
export function historyCommit(
  hist: GraphHistory,
  next: ProjectGraphState,
  maxPast = 40,
): GraphHistory {
  if (graphFingerprint(hist.present) === graphFingerprint(next)) {
    // selection-only: update present without stack
    return { ...hist, present: cloneGraph(next) };
  }
  return {
    past: [...hist.past, cloneGraph(hist.present)].slice(-maxPast),
    present: cloneGraph(next),
    future: [],
  };
}

export function historyUndo(hist: GraphHistory): GraphHistory {
  if (hist.past.length === 0) return hist;
  const previous = hist.past[hist.past.length - 1]!;
  return {
    past: hist.past.slice(0, -1),
    present: cloneGraph(previous),
    future: [cloneGraph(hist.present), ...hist.future],
  };
}

export function historyRedo(hist: GraphHistory): GraphHistory {
  if (hist.future.length === 0) return hist;
  const nxt = hist.future[0]!;
  return {
    past: [...hist.past, cloneGraph(hist.present)],
    present: cloneGraph(nxt),
    future: hist.future.slice(1),
  };
}

/**
 * Tree keyboard navigation (Project Graph–ish):
 * ArrowLeft → parent, ArrowRight → first child,
 * ArrowUp/Down → prev/next sibling under same parent.
 */
/**
 * Stack children of the selected node to the right (y-sorted), like a light tree format.
 * No-op without selection or children.
 */
export function layoutChildren(state: ProjectGraphState): ProjectGraphState {
  const id = state.selectedId;
  if (!id) return state;
  const parent = getNode(state, id);
  if (!parent) return state;
  const kids = childrenOf(state, id).sort((a, b) => a.y - b.y || a.x - b.x);
  if (kids.length === 0) return state;
  const next = cloneState(state);
  let y = parent.y;
  const x = parent.x + parent.width + GROW_GAP_X;
  for (const k of kids) {
    const n = next.nodes.find((node) => node.id === k.id);
    if (!n) continue;
    n.x = x;
    n.y = y;
    y += n.height + GROW_GAP_Y;
  }
  return next;
}

/**
 * Export graph as ATX heading outline (roots = no incoming edge).
 * Children ordered by y then x — useful to push canvas structure back into MD.
 */
export function graphToMarkdownOutline(state: ProjectGraphState): string {
  const hasIncoming = new Set(state.edges.map((e) => e.to));
  const roots = state.nodes
    .filter((n) => !hasIncoming.has(n.id))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: string[] = [];
  const visit = (id: string, level: number) => {
    const n = getNode(state, id);
    if (!n) return;
    const hashes = "#".repeat(Math.min(6, Math.max(1, level)));
    lines.push(`${hashes} ${n.text}`);
    const kids = childrenOf(state, id).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const k of kids) visit(k.id, level + 1);
  };
  for (const r of roots) visit(r.id, 1);
  return lines.join("\n\n");
}

/** Safe mermaid node id from graph node id. */
function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mermaidLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/\n/g, " ");
}

/**
 * Export graph as a Mermaid flowchart (LR). Useful for paste into docs / AI.
 */
export function graphToMermaid(state: ProjectGraphState): string {
  const lines = ["flowchart LR"];
  for (const n of state.nodes) {
    lines.push(`  ${mermaidId(n.id)}["${mermaidLabel(n.text)}"]`);
  }
  for (const e of state.edges) {
    lines.push(`  ${mermaidId(e.from)} --> ${mermaidId(e.to)}`);
  }
  if (state.nodes.length === 0) {
    lines.push('  empty["空图"]');
  }
  return lines.join("\n");
}

/** Select first root node (no incoming edge), or null selection if empty. */
export function selectRoot(state: ProjectGraphState): ProjectGraphState {
  if (state.nodes.length === 0) return selectNode(state, null);
  const hasIncoming = new Set(state.edges.map((e) => e.to));
  const roots = state.nodes
    .filter((n) => !hasIncoming.has(n.id))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const root = roots[0] ?? state.nodes[0]!;
  return selectNode(state, root.id);
}

export function navigateTree(
  state: ProjectGraphState,
  dir: "parent" | "firstChild" | "prevSibling" | "nextSibling",
): ProjectGraphState {
  const id = state.selectedId;
  if (!id) return state;

  if (dir === "parent") {
    const p = findParentId(state, id);
    return p ? selectNode(state, p) : state;
  }

  if (dir === "firstChild") {
    const kids = childrenOf(state, id).sort((a, b) => a.y - b.y || a.x - b.x);
    return kids[0] ? selectNode(state, kids[0].id) : state;
  }

  const parentId = findParentId(state, id);
  // siblings: same parent (or all roots if no parent)
  let siblings: GraphNode[];
  if (parentId) {
    siblings = childrenOf(state, parentId).sort(
      (a, b) => a.y - b.y || a.x - b.x,
    );
  } else {
    const childIds = new Set(state.edges.map((e) => e.to));
    siblings = state.nodes
      .filter((n) => !childIds.has(n.id))
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }
  const idx = siblings.findIndex((n) => n.id === id);
  if (idx < 0) return state;
  if (dir === "prevSibling") {
    const t = siblings[idx - 1];
    return t ? selectNode(state, t.id) : state;
  }
  const t = siblings[idx + 1];
  return t ? selectNode(state, t.id) : state;
}


