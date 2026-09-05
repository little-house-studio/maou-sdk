/**
 * Session persistence helpers for draft project workbench.
 * Pure parse/serialize so refresh does not wipe local MD/canvas edits.
 */

import type { ProjectDoc } from "./project-docs";
import type { ProjectGraphState } from "./project-graph";
import { emptyGraph } from "./project-graph";

export const PROJECT_SESSION_VERSION = 1 as const;

export type ProjectSessionSnapshot = {
  v: typeof PROJECT_SESSION_VERSION;
  activePath?: string;
  /** MRU open tabs (paths). */
  recentPaths?: string[];
  drafts: Record<string, string>;
  contentBaselines: Record<string, string>;
  graphs: Record<string, ProjectGraphState>;
  graphBaselines: Record<string, string>;
  hideTree?: boolean;
  hideOutline?: boolean;
};

export function projectSessionKey(projectPath: string): string {
  return `maou-draft-project-session:v${PROJECT_SESSION_VERSION}:${projectPath}`;
}

export function isValidGraphState(value: unknown): value is ProjectGraphState {
  if (!value || typeof value !== "object") return false;
  const g = value as ProjectGraphState;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return false;
  if (typeof g.nextId !== "number") return false;
  if (!(g.selectedId === null || typeof g.selectedId === "string")) return false;
  for (const n of g.nodes) {
    if (
      !n ||
      typeof n.id !== "string" ||
      typeof n.text !== "string" ||
      typeof n.x !== "number" ||
      typeof n.y !== "number"
    ) {
      return false;
    }
  }
  for (const e of g.edges) {
    if (
      !e ||
      typeof e.id !== "string" ||
      typeof e.from !== "string" ||
      typeof e.to !== "string"
    ) {
      return false;
    }
  }
  return true;
}

/** Build initial drafts map from fixtures, optionally merged with saved drafts. */
export function mergeDraftsWithFixtures(
  docs: ProjectDoc[],
  saved: Record<string, string> | undefined,
): Record<string, string> {
  const init: Record<string, string> = {};
  for (const d of docs) {
    init[d.path] =
      saved && typeof saved[d.path] === "string" ? saved[d.path]! : d.content;
  }
  return init;
}

export function parseProjectSession(
  raw: string | null | undefined,
): ProjectSessionSnapshot | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as ProjectSessionSnapshot;
    if (!data || data.v !== PROJECT_SESSION_VERSION) return null;
    if (!data.drafts || typeof data.drafts !== "object") return null;
    const graphs: Record<string, ProjectGraphState> = {};
    if (data.graphs && typeof data.graphs === "object") {
      for (const [path, g] of Object.entries(data.graphs)) {
        if (isValidGraphState(g)) graphs[path] = g;
      }
    }
    const recentPaths = Array.isArray(data.recentPaths)
      ? data.recentPaths.filter((p): p is string => typeof p === "string")
      : undefined;

    return {
      v: PROJECT_SESSION_VERSION,
      activePath:
        typeof data.activePath === "string" ? data.activePath : undefined,
      recentPaths,
      drafts: data.drafts as Record<string, string>,
      contentBaselines:
        data.contentBaselines && typeof data.contentBaselines === "object"
          ? (data.contentBaselines as Record<string, string>)
          : {},
      graphs,
      graphBaselines:
        data.graphBaselines && typeof data.graphBaselines === "object"
          ? (data.graphBaselines as Record<string, string>)
          : {},
      hideTree: Boolean(data.hideTree),
      hideOutline: Boolean(data.hideOutline),
    };
  } catch {
    return null;
  }
}

export function serializeProjectSession(
  snap: ProjectSessionSnapshot,
): string {
  return JSON.stringify(snap);
}

export function readProjectSession(
  projectPath: string,
): ProjectSessionSnapshot | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return parseProjectSession(sessionStorage.getItem(projectSessionKey(projectPath)));
  } catch {
    return null;
  }
}

export function writeProjectSession(
  projectPath: string,
  snap: ProjectSessionSnapshot,
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      projectSessionKey(projectPath),
      serializeProjectSession(snap),
    );
  } catch {
    /* quota / private mode */
  }
}

/** Drop persisted session for a project (fixtures reload on next visit). */
export function clearProjectSession(projectPath: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(projectSessionKey(projectPath));
  } catch {
    /* ignore */
  }
}

/**
 * Keep MRU path list: move path to front, cap length, drop unknowns.
 */
export function pushRecentPath(
  recent: string[],
  path: string,
  max = 8,
): string[] {
  const next = [path, ...recent.filter((p) => p !== path)];
  return next.slice(0, max);
}

/** Keep only paths that still exist in the doc catalog; ensure non-empty. */
export function sanitizeRecentPaths(
  recent: string[] | undefined,
  knownPaths: string[],
  fallback: string,
  max = 8,
): string[] {
  const known = new Set(knownPaths);
  const cleaned = (recent ?? []).filter((p) => known.has(p)).slice(0, max);
  if (cleaned.length > 0) return cleaned;
  return known.has(fallback) ? [fallback] : knownPaths.slice(0, 1);
}

/** Cycle active path within recent list (dir +1 next / -1 prev). */
export function cycleRecentPath(
  recent: string[],
  active: string,
  dir: 1 | -1,
): string | null {
  if (recent.length === 0) return null;
  const idx = recent.indexOf(active);
  const base = idx < 0 ? 0 : idx;
  const next = (base + dir + recent.length * 8) % recent.length;
  return recent[next] ?? null;
}

/**
 * Remove path from recent; if it was active, activate the next MRU entry.
 */
export function closeRecentPath(
  recent: string[],
  path: string,
  active: string,
): { recent: string[]; active: string } {
  const nextRecent = recent.filter((p) => p !== path);
  if (path !== active) {
    return { recent: nextRecent, active };
  }
  if (nextRecent.length === 0) {
    return { recent: nextRecent, active };
  }
  // Prefer the path that was next after closed (MRU order: index 0 is newest)
  const closedIdx = recent.indexOf(path);
  const prefer =
    recent[closedIdx + 1] ??
    recent[closedIdx - 1] ??
    nextRecent[0]!;
  const activeNext = nextRecent.includes(prefer) ? prefer : nextRecent[0]!;
  return { recent: nextRecent, active: activeNext };
}

/** Ordered dirty fixture paths (stable doc order). */
export function listDirtyDocPaths(
  docs: { path: string; content: string }[],
  drafts: Record<string, string>,
  contentBaselines: Record<string, string>,
  graphs: Record<string, ProjectGraphState>,
  graphBaselines: Record<string, string>,
  fingerprint: (g: ProjectGraphState) => string,
): string[] {
  const out: string[] = [];
  for (const d of docs) {
    const body = drafts[d.path] ?? d.content;
    const base = contentBaselines[d.path] ?? d.content;
    const mdDirty = body !== base;
    const g = graphs[d.path];
    const gBase = graphBaselines[d.path];
    const gDirty =
      g != null && gBase != null && fingerprint(g) !== gBase;
    if (mdDirty || gDirty) out.push(d.path);
  }
  return out;
}

/** True when outline title tree differs from graph title tree (prompt rebuild). */
export function outlineGraphDrift(
  outlineTitles: { level: number; title: string }[],
  graph: ProjectGraphState | null | undefined,
): boolean {
  if (!graph || graph.nodes.length === 0) return outlineTitles.length > 0;
  const o = outlineTitles.map((h) => `${h.level}:${h.title}`).join("\n");
  // Compare using level-agnostic ordered title walk from edges
  const hasIncoming = new Set(graph.edges.map((e) => e.to));
  const roots = graph.nodes
    .filter((n) => !hasIncoming.has(n.id))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: string[] = [];
  const kids = (id: string) =>
    graph.edges
      .filter((e) => e.from === id)
      .map((e) => graph.nodes.find((n) => n.id === e.to)!)
      .filter(Boolean)
      .sort((a, b) => a.y - b.y || a.x - b.x);
  const visit = (id: string, level: number) => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return;
    lines.push(`${level}:${n.text}`);
    for (const c of kids(id)) visit(c.id, level + 1);
  };
  for (const r of roots) visit(r.id, 1);
  const g = lines.join("\n");
  return o !== g;
}

export function emptySessionFromDocs(docs: ProjectDoc[]): ProjectSessionSnapshot {
  return {
    v: PROJECT_SESSION_VERSION,
    drafts: mergeDraftsWithFixtures(docs, undefined),
    contentBaselines: {},
    graphs: {},
    graphBaselines: {},
  };
}

/** Safe graph or empty — used by tests and restore. */
export function coerceGraph(value: unknown): ProjectGraphState {
  return isValidGraphState(value) ? value : emptyGraph();
}
