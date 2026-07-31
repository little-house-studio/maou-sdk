/**
 * Build a VS Code–style file tree from flat path strings.
 * Paths ending with `/` are treated as empty folders.
 */

export type FileTreeNode = {
  name: string;
  path: string;
  kind: "folder" | "file";
  children?: FileTreeNode[];
  /** Optional “dirty” marker like VS Code “M” */
  modified?: boolean;
};

export type FileIconKind =
  | "folder"
  | "folder-open"
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "json"
  | "md"
  | "html"
  | "css"
  | "git"
  | "lock"
  | "config"
  | "img"
  | "default";

export function fileIconKind(name: string, isFolder: boolean, open?: boolean): FileIconKind {
  if (isFolder) return open ? "folder-open" : "folder";
  const lower = name.toLowerCase();
  if (lower === ".gitignore" || lower.endsWith(".git")) return "git";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return "js";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "md";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return "css";
  if (lower.includes("lock") || lower === "pnpm-lock.yaml") return "lock";
  if (
    lower === "tsconfig.json" ||
    lower.startsWith("tsconfig.") ||
    lower === "vite.config.ts" ||
    lower === "vite.config.js"
  )
    return "config";
  if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(lower)) return "img";
  return "default";
}

/** Parse "path/to/file.tsx" or "path/to/dir/" into nested nodes. */
export function buildFileTree(paths: string[]): FileTreeNode[] {
  type Mutable = {
    name: string;
    path: string;
    kind: "folder" | "file";
    children?: Map<string, Mutable>;
    modified?: boolean;
  };

  const roots = new Map<string, Mutable>();

  for (const raw of paths) {
    const modified = raw.includes("\0M") || raw.endsWith(" *");
    let p = raw.replace(/\0M$/, "").replace(/ \*$/, "").replace(/\\/g, "/");
    const isDir = p.endsWith("/");
    if (isDir) p = p.replace(/\/+$/, "");
    if (!p) continue;

    const parts = p.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let map = roots;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      acc = acc ? `${acc}/${name}` : name;
      const isLast = i === parts.length - 1;
      const asFolder = !isLast || isDir;

      let node = map.get(name);
      if (!node) {
        node = {
          name,
          path: acc,
          kind: asFolder ? "folder" : "file",
          children: asFolder ? new Map() : undefined,
          modified: isLast && modified ? true : undefined,
        };
        map.set(name, node);
      } else if (asFolder && node.kind === "file") {
        node.kind = "folder";
        node.children = new Map();
      }
      if (asFolder) {
        if (!node.children) node.children = new Map();
        map = node.children;
      }
      if (isLast && modified) node.modified = true;
    }
  }

  function toList(m: Map<string, Mutable>): FileTreeNode[] {
    const list = [...m.values()].map((n) => {
      const children = n.children ? toList(n.children) : undefined;
      const out: FileTreeNode = {
        name: n.name,
        path: n.path,
        kind: n.kind,
      };
      if (children && children.length) out.children = children;
      if (n.modified) out.modified = true;
      return out;
    });
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return list;
  }

  return toList(roots);
}

/** Default expanded folder paths: all roots + first level. */
export function defaultExpandedPaths(roots: FileTreeNode[]): Set<string> {
  const set = new Set<string>();
  for (const r of roots) {
    if (r.kind === "folder") {
      set.add(r.path);
      for (const c of r.children ?? []) {
        if (c.kind === "folder") set.add(c.path);
      }
    }
  }
  return set;
}
