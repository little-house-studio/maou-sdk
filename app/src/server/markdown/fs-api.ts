/**
 * 项目内文件系统 API（WebUI Markdown 编辑器用）
 * 所有路径必须落在 projectRoot 内，防目录穿越。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

const MD_EXTS = new Set([".md", ".mdx", ".markdown"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  "vendor",
  ".turbo",
  "coverage",
  ".cache",
]);

export type FsTreeNode = {
  name: string;
  path: string; // 相对 projectRoot
  type: "file" | "dir";
  children?: FsTreeNode[];
};

function isMdFile(name: string): boolean {
  return MD_EXTS.has(extname(name).toLowerCase());
}

/** 解析并校验路径：返回绝对路径；非法则 throw */
export function resolveSafePath(projectRoot: string, relOrAbs: string): string {
  const root = resolve(projectRoot);
  const raw = String(relOrAbs || "").trim();
  if (!raw) throw new Error("path required");
  // 禁止绝对路径跳出；统一按相对 root 处理
  const candidate = raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)
    ? resolve(raw)
    : resolve(root, raw);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel === ".." || rel.includes(`..${sep}`)) {
    throw new Error("path outside project root");
  }
  // 规范化后仍需在 root 下
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error("path outside project root");
  }
  return candidate;
}

function walkMdTree(absDir: string, root: string, depth: number): FsTreeNode[] {
  if (depth > 12) return [];
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return [];
  }
  const dirs: FsTreeNode[] = [];
  const files: FsTreeNode[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith(".") && name !== ".maou") continue;
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const rel = relative(root, abs).split(sep).join("/");
    if (st.isDirectory()) {
      const children = walkMdTree(abs, root, depth + 1);
      if (children.length > 0) {
        dirs.push({ name, path: rel, type: "dir", children });
      }
    } else if (st.isFile() && isMdFile(name)) {
      files.push({ name, path: rel, type: "file" });
    }
  }
  return [...dirs, ...files];
}

export function listMarkdownTree(projectRoot: string): FsTreeNode[] {
  const root = resolve(projectRoot);
  if (!existsSync(root)) return [];
  return walkMdTree(root, root, 0);
}

export function readProjectFile(
  projectRoot: string,
  relPath: string,
): { path: string; content: string; size: number } {
  const abs = resolveSafePath(projectRoot, relPath);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error("file not found");
  }
  if (!isMdFile(abs)) {
    throw new Error("only markdown files are allowed");
  }
  const content = readFileSync(abs, "utf8");
  return {
    path: relative(resolve(projectRoot), abs).split(sep).join("/"),
    content,
    size: Buffer.byteLength(content, "utf8"),
  };
}

export function writeProjectFile(
  projectRoot: string,
  relPath: string,
  content: string,
): { path: string; size: number } {
  const abs = resolveSafePath(projectRoot, relPath);
  if (!isMdFile(abs)) {
    throw new Error("only markdown files are allowed");
  }
  const dir = dirname(abs);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(abs, content, "utf8");
  return {
    path: relative(resolve(projectRoot), abs).split(sep).join("/"),
    size: Buffer.byteLength(content, "utf8"),
  };
}

export function createMarkdownFile(
  projectRoot: string,
  relPath: string,
  initial = "# New document\n\n",
): { path: string } {
  let path = relPath.trim();
  if (!path) throw new Error("path required");
  if (!isMdFile(path)) path = `${path}.md`;
  const abs = resolveSafePath(projectRoot, path);
  if (existsSync(abs)) throw new Error("file already exists");
  writeProjectFile(projectRoot, path, initial);
  return {
    path: relative(resolve(projectRoot), abs).split(sep).join("/"),
  };
}
