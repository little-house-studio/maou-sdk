/**
 * Markdown 模块 · 浏览器侧 FS API
 * 仅对接 /api/fs/*（projectRoot 内 Markdown）
 */

export type FsTreeNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FsTreeNode[];
};

export async function fetchMdTree(): Promise<{
  root: string;
  tree: FsTreeNode[];
}> {
  const r = await fetch("/api/fs/md-tree");
  if (!r.ok) throw new Error(`md-tree ${r.status}`);
  const j = (await r.json()) as {
    ok?: boolean;
    root?: string;
    tree?: FsTreeNode[];
    error?: string;
  };
  if (j.ok === false) throw new Error(j.error || "md-tree failed");
  return { root: j.root ?? "", tree: j.tree ?? [] };
}

export async function readFsFile(
  path: string,
): Promise<{ path: string; content: string }> {
  const r = await fetch(`/api/fs/file?path=${encodeURIComponent(path)}`);
  const j = (await r.json()) as {
    ok?: boolean;
    path?: string;
    content?: string;
    error?: string;
  };
  if (!r.ok || j.ok === false) throw new Error(j.error || `read ${r.status}`);
  return { path: j.path ?? path, content: j.content ?? "" };
}

export async function writeFsFile(
  path: string,
  content: string,
): Promise<void> {
  const r = await fetch("/api/fs/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  const j = (await r.json()) as { ok?: boolean; error?: string };
  if (!r.ok || j.ok === false) throw new Error(j.error || `write ${r.status}`);
}

export async function createFsFile(
  path: string,
  content?: string,
): Promise<string> {
  const r = await fetch("/api/fs/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  const j = (await r.json()) as { ok?: boolean; path?: string; error?: string };
  if (!r.ok || j.ok === false) throw new Error(j.error || `create ${r.status}`);
  return j.path ?? path;
}
