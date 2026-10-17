/** Live Markdown documents; loading failures must never become writable empty files. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectWorkbench } from "../wire/project/ProjectWorkbench";
import type { ProjectDoc } from "../wire/project/project-docs";
import { useAppPorts } from "../ports";
import type { FsTreeNode } from "../markdown/api";
import { kindFromPath, pickInitialPath, titleFromPath, withDocContent } from "./project-host-docs";

export type LiveProjectHostProps = { projectLabel: string; projectPath: string };

function flattenFsFiles(nodes: FsTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === "file" && /\.md$/i.test(n.path)) acc.push(n.path);
    if (n.children?.length) flattenFsFiles(n.children, acc);
  }
  return acc;
}

export function LiveProjectHost({ projectLabel, projectPath }: LiveProjectHostProps) {
  const { fetchMdTree, readFsFile, writeFsFile } = useAppPorts().files;
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [source, setSource] = useState<"loading" | "live" | "error">("loading");
  const [hint, setHint] = useState("加载项目文档…");
  const [readError, setReadError] = useState("");
  const [loadedPaths, setLoadedPaths] = useState<ReadonlySet<string>>(new Set());
  const loadedRef = useRef(new Set<string>());
  const inflightRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const activePathRef = useRef("");

  const ensureContent = useCallback(async (path: string) => {
    if (!path || loadedRef.current.has(path) || inflightRef.current.has(path)) return;
    const generation = generationRef.current;
    inflightRef.current.add(path);
    setReadError("");
    try {
      const f = await readFsFile(path);
      if (generation !== generationRef.current) return;
      loadedRef.current.add(path);
      setLoadedPaths(new Set(loadedRef.current));
      setDocs((prev) => withDocContent(prev, path, f.content));
    } catch (e) {
      if (generation === generationRef.current && activePathRef.current === path) {
        setReadError(`读取 ${path} 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (generation === generationRef.current) inflightRef.current.delete(path);
    }
  }, [readFsFile]);

  const loadLive = useCallback(async () => {
    const generation = ++generationRef.current;
    setSource("loading");
    setHint("加载项目文档…");
    setReadError("");
    loadedRef.current = new Set();
    inflightRef.current = new Set();
    setLoadedPaths(new Set());
    try {
      const { tree } = await fetchMdTree();
      if (generation !== generationRef.current) return;
      const paths = flattenFsFiles(tree).slice(0, 64);
      // Only successful reads count as loaded, including genuinely empty files.
      const bodies = new Map<string, string>();
      await Promise.all(paths.slice(0, 16).map(async (path) => {
        try { bodies.set(path, (await readFsFile(path)).content); } catch { /* retry on open */ }
      }));
      if (generation !== generationRef.current) return;
      loadedRef.current = new Set(bodies.keys());
      setLoadedPaths(new Set(loadedRef.current));
      setDocs(paths.map((path) => ({ path, title: titleFromPath(path), kind: kindFromPath(path), content: bodies.get(path) ?? "" })));
      setSource("live");
      setHint(paths.length ? `${paths.length} 个 Markdown 文档` : "当前项目没有 Markdown 文档");
      const initial = pickInitialPath(paths);
      if (initial) void ensureContent(initial);
    } catch (e) {
      if (generation !== generationRef.current) return;
      setSource("error");
      setHint(`项目文档加载失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [ensureContent, fetchMdTree, readFsFile]);

  useEffect(() => {
    void loadLive();
    return () => { generationRef.current += 1; };
  }, [loadLive, projectPath]);

  const onPersistMarkdown = useCallback(async (path: string, content: string) => {
    if (!loadedRef.current.has(path)) throw new Error("文档尚未读取成功，请重试加载后保存");
    const generation = generationRef.current;
    await writeFsFile(path, content);
    if (generation === generationRef.current) setDocs((prev) => withDocContent(prev, path, content));
  }, [writeFsFile]);

  const onActivePathChange = useCallback((path: string) => {
    activePathRef.current = path;
    setReadError("");
    void ensureContent(path);
  }, [ensureContent]);

  return (
    <div className="live-project-host is-workbench" data-live-project={source} data-live-project-hint={hint}>
      {source !== "live" || docs.length === 0 ? (
        <div className="live-project-hint" role={source === "error" ? "alert" : "status"}>
          {hint}
          {source !== "loading" ? <button type="button" onClick={() => void loadLive()}>重新加载</button> : null}
        </div>
      ) : (
        <>
          {readError ? <div className="live-project-hint" role="alert">{readError} <button type="button" onClick={() => void ensureContent(activePathRef.current)}>重试读取</button></div> : null}
          <ProjectWorkbench key={projectPath} projectLabel={projectLabel} projectPath={projectPath} docs={docs} loadedPaths={loadedPaths} onPersistMarkdown={onPersistMarkdown} onActivePathChange={onActivePathChange} />
        </>
      )}
    </div>
  );
}
