/**
 * Project mode host: draft ProjectWorkbench chrome + live FS docs.
 * Loads markdown tree via /api/fs; persist on 同步 via writeFsFile.
 * Falls back to MarkdownWorkbench when tree empty/offline.
 */
import { useCallback, useEffect, useState } from "react";
import { ProjectWorkbench } from "../drafts/panels/ProjectWorkbench";
import type { ProjectDoc, ProjectDocKind } from "../drafts/project-docs";
import { MarkdownWorkbench } from "../markdown";
import {
  fetchMdTree,
  readFsFile,
  writeFsFile,
  type FsTreeNode,
} from "../markdown/api";

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

function kindFromPath(path: string): ProjectDocKind {
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

function titleFromPath(path: string): string {
  const base = path.split("/").pop() || path;
  return base.replace(/\.md$/i, "") || path;
}

export function LiveProjectHost({
  projectLabel,
  projectPath,
}: LiveProjectHostProps) {
  const [docs, setDocs] = useState<ProjectDoc[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [hint, setHint] = useState("加载项目文档…");
  const [useWorkbench, setUseWorkbench] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setHint("加载项目文档…");
    try {
      const { tree } = await fetchMdTree();
      const paths = flattenFsFiles(tree).slice(0, 48);
      if (paths.length === 0) {
        setDocs(null);
        setStatus("fallback");
        setHint("无 markdown 文件 · 使用文档工作台");
        return;
      }
      const loaded: ProjectDoc[] = [];
      for (const path of paths) {
        try {
          const f = await readFsFile(path);
          loaded.push({
            path,
            title: titleFromPath(path),
            kind: kindFromPath(path),
            content: f.content,
          });
        } catch {
          /* skip unreadable */
        }
      }
      if (loaded.length === 0) {
        setDocs(null);
        setStatus("fallback");
        setHint("读取失败 · 使用文档工作台");
        return;
      }
      setDocs(loaded);
      setStatus("ready");
      setHint(`${loaded.length} 个文档 · live FS`);
    } catch (e) {
      setDocs(null);
      setStatus("fallback");
      setHint(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, projectPath]);

  const onPersistMarkdown = useCallback(
    async (path: string, content: string) => {
      await writeFsFile(path, content);
    },
    [],
  );

  if (useWorkbench || status === "fallback") {
    return (
      <div className="live-project-host" data-live-project="fallback">
        <div className="live-project-bar">
          <span className="live-project-hint" title={hint}>
            {hint}
          </span>
          {status === "ready" && docs ? (
            <button
              type="button"
              className="wire-text-btn"
              onClick={() => setUseWorkbench(false)}
            >
              项目工作台
            </button>
          ) : (
            <button
              type="button"
              className="wire-text-btn"
              onClick={() => void load()}
            >
              重试加载
            </button>
          )}
        </div>
        <MarkdownWorkbench />
      </div>
    );
  }

  if (status === "loading" || !docs) {
    return (
      <div className="live-project-host is-loading" data-live-project="loading">
        <div className="live-project-bar">
          <span className="live-project-hint">{hint}</span>
          <button
            type="button"
            className="wire-text-btn"
            onClick={() => setUseWorkbench(true)}
          >
            文档工作台
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="live-project-host is-workbench" data-live-project="ready">
      <div className="live-project-bar">
        <span className="live-project-hint" title={hint}>
          {hint}
        </span>
        <button
          type="button"
          className="wire-text-btn"
          onClick={() => setUseWorkbench(true)}
        >
          文档工作台
        </button>
      </div>
      <ProjectWorkbench
        projectLabel={projectLabel}
        projectPath={projectPath}
        docs={docs}
        onPersistMarkdown={onPersistMarkdown}
      />
    </div>
  );
}
