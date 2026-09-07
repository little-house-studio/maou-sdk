/**
 * 项目模式：整页 ProjectWorkbench。
 * 文档来源优先 live FS（/api/fs/md-tree + 按需/预取正文）；失败时回退 PROJECT_DOCS。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectWorkbench } from "../wire/project/ProjectWorkbench";
import {
  PROJECT_DOCS,
  type ProjectDoc,
} from "../wire/project/project-docs";
import { useAppPorts } from "../ports";
import type { FsTreeNode } from "../markdown/api";
import {
  kindFromPath,
  needsContentLoad,
  pickInitialPath,
  titleFromPath,
  withDocContent,
} from "./project-host-docs";

export type LiveProjectHostProps = {
  projectLabel: string;
  projectPath: string;
};

function flattenFsFiles(nodes: FsTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === "file" && /\.md$/i.test(n.path)) acc.push(n.path);
    if (n.children?.length) flattenFsFiles(n.children, acc);
  }
  return acc;
}

/** 预取前 N 个文件正文，避免工作台打开时一片空/黑 */
async function prefetchContents(
  paths: string[],
  readFsFile: (path: string) => Promise<{ path: string; content: string }>,
  limit = 12,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const slice = paths.slice(0, limit);
  await Promise.all(
    slice.map(async (path) => {
      try {
        const f = await readFsFile(path);
        map.set(path, f.content);
      } catch {
        map.set(path, "");
      }
    }),
  );
  return map;
}

export function LiveProjectHost({
  projectLabel,
  projectPath,
}: LiveProjectHostProps) {
  const { fetchMdTree, readFsFile, writeFsFile } = useAppPorts().files;
  // 先用 PROJECT_DOCS 占位，保证立刻有完整 UI
  const [docs, setDocs] = useState<ProjectDoc[]>(() => PROJECT_DOCS);
  const [source, setSource] = useState<"draft" | "live">("draft");
  const [hint, setHint] = useState("加载项目文档…");
  const loadedRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Set<string>>(new Set());

  const ensureContent = useCallback(async (path: string) => {
    if (!path || loadedRef.current.has(path) || inflightRef.current.has(path)) {
      return;
    }
    inflightRef.current.add(path);
    try {
      const f = await readFsFile(path);
      loadedRef.current.add(path);
      setDocs((prev) => withDocContent(prev, path, f.content));
    } catch {
      loadedRef.current.add(path);
    } finally {
      inflightRef.current.delete(path);
    }
  }, [readFsFile]);

  const loadLive = useCallback(async () => {
    setHint("加载项目文档…");
    loadedRef.current = new Set();
    inflightRef.current = new Set();
    try {
      const { tree } = await fetchMdTree();
      const paths = flattenFsFiles(tree).slice(0, 64);
      if (paths.length === 0) {
        setDocs(PROJECT_DOCS);
        setSource("draft");
        setHint("无 live markdown · 使用内置文档");
        return;
      }
      const bodies = await prefetchContents(paths, readFsFile, 16);
      const docsLive: ProjectDoc[] = paths.map((path) => ({
        path,
        title: titleFromPath(path),
        kind: kindFromPath(path),
        content: bodies.get(path) ?? "",
      }));
      for (const [p, c] of bodies) {
        if (c) loadedRef.current.add(p);
      }
      setDocs(docsLive);
      setSource("live");
      setHint(`${docsLive.length} 个文档 · live FS`);
      // 未预取的路径保持空 content，切换时 onActivePathChange 再拉
      const initial = pickInitialPath(paths);
      if (initial && !loadedRef.current.has(initial)) {
        void ensureContent(initial);
      }
    } catch (e) {
      setDocs(PROJECT_DOCS);
      setSource("draft");
      setHint(
        `live 加载失败 · 内置文档：${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }, [ensureContent, fetchMdTree, readFsFile]);

  useEffect(() => {
    void loadLive();
  }, [loadLive, projectPath]);

  const onPersistMarkdown = useCallback(
    async (path: string, content: string) => {
      if (source === "live") {
        await writeFsFile(path, content);
      }
      loadedRef.current.add(path);
      setDocs((prev) => withDocContent(prev, path, content));
    },
    [source, writeFsFile],
  );

  const onActivePathChange = useCallback(
    (path: string) => {
      if (source !== "live") return;
      if (needsContentLoad(docs, path, loadedRef.current)) {
        void ensureContent(path);
      }
    },
    [docs, ensureContent, source],
  );

  return (
    <div
      className="live-project-host is-workbench"
      data-live-project={source}
      data-live-project-hint={hint}
    >
      <ProjectWorkbench
        projectLabel={projectLabel}
        projectPath={projectPath}
        docs={docs}
        onPersistMarkdown={onPersistMarkdown}
        onActivePathChange={onActivePathChange}
      />
    </div>
  );
}
