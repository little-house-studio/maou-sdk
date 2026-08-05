/**
 * Pure helpers for LiveProjectHost: tree stubs + on-demand content fill.
 * Keeps initial project shell cheap (paths/meta only; body load separate).
 */
import type { ProjectDoc, ProjectDocKind } from "../drafts/project-docs";
import { DEFAULT_PROJECT_DOC_PATH } from "../drafts/project-docs";

export function kindFromPath(path: string): ProjectDocKind {
  const base = (path.split("/").pop() || "").toUpperCase();
  if (base === "PROJECT.MD") return "project";
  if (base === "USER.MD") return "user";
  if (base === "RULE.MD" || base === "RULES.MD") return "rule";
  if (base === "DESIGN.MD") return "design";
  if (base === "EXPERIENCE.MD") return "experience";
  if (path.includes(".maou/project/")) return "project";
  if (/\.md$/i.test(path)) return "doc";
  return "other";
}

export function titleFromPath(path: string): string {
  const base = path.split("/").pop() || path;
  return base.replace(/\.md$/i, "") || path;
}

/** Meta-only stubs: empty content until host loads the active file. */
export function stubsFromPaths(paths: string[]): ProjectDoc[] {
  return paths.map((path) => ({
    path,
    title: titleFromPath(path),
    kind: kindFromPath(path),
    content: "",
  }));
}

export function withDocContent(
  docs: ProjectDoc[],
  path: string,
  content: string,
): ProjectDoc[] {
  let hit = false;
  const next = docs.map((d) => {
    if (d.path !== path) return d;
    hit = true;
    return { ...d, content };
  });
  if (!hit) {
    next.push({
      path,
      title: titleFromPath(path),
      kind: kindFromPath(path),
      content,
    });
  }
  return next;
}

/** Prefer CLI project root doc, else first path. */
export function pickInitialPath(paths: string[]): string | null {
  if (!paths.length) return null;
  if (paths.includes(DEFAULT_PROJECT_DOC_PATH)) return DEFAULT_PROJECT_DOC_PATH;
  return paths[0] ?? null;
}

/** True when host still needs to fetch body for this path. */
export function needsContentLoad(
  docs: ProjectDoc[],
  path: string,
  loaded: ReadonlySet<string>,
): boolean {
  if (!path || loaded.has(path)) return false;
  const doc = docs.find((d) => d.path === path);
  if (!doc) return false;
  return doc.content === "";
}
