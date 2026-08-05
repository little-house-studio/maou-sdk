/**
 * Live right-rail files: draft FilesRail chrome + real /api/fs/md-tree paths.
 * Selecting a file opens MarkdownWorkbench (lazy — CodeMirror not on chat paint).
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { FilesRail } from "../drafts/panels/FilesRail";
import { fetchMdTree, type FsTreeNode } from "../markdown/api";

const MarkdownWorkbenchLazy = lazy(() =>
  import("../markdown/MarkdownWorkbench").then((m) => ({
    default: m.MarkdownWorkbench,
  })),
);

function flattenFsPaths(nodes: FsTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === "file") acc.push(n.path);
    if (n.children?.length) flattenFsPaths(n.children, acc);
  }
  return acc;
}

export function LiveFilesRail() {
  const [paths, setPaths] = useState<string[]>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { tree } = await fetchMdTree();
      const next = flattenFsPaths(tree);
      setPaths((prev) => {
        if (
          prev.length === next.length &&
          prev.every((p, i) => p === next[i])
        ) {
          return prev;
        }
        return next;
      });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPaths((prev) => (prev.length === 0 ? prev : []));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return (
    <div className="live-files-rail-stack" data-live-files-rail="true">
      <div className="live-files-tree">
        <FilesRail
          paths={paths}
          rootLabel="文件"
          diff={
            err
              ? { add: 0, del: 0, file: "offline" }
              : { add: 0, del: 0, file: paths[0] || "—" }
          }
          onFileOpen={(p) => {
            // Opt-in preview: only markdown files (folders stay expand-only)
            if (/\.(md|mdx|markdown)$/i.test(p)) setOpenPath(p);
          }}
        />
      </div>
      {openPath ? (
        <div className="live-files-editor" data-live-files-editor={openPath}>
          <div className="live-files-editor-head">
            <span className="live-files-editor-path" title={openPath}>
              {openPath}
            </span>
            <button
              type="button"
              className="wire-text-btn"
              onClick={() => setOpenPath(null)}
            >
              关闭预览
            </button>
          </div>
          <Suspense
            fallback={
              <div className="live-files-err" data-live-files-loading="true">
                加载编辑器…
              </div>
            }
          >
            <MarkdownWorkbenchLazy
              openPath={openPath}
              onOpenConsumed={() => {
                /* keep path selected for re-open */
              }}
            />
          </Suspense>
        </div>
      ) : null}
      {err ? (
        <div className="live-files-err" title={err}>
          FS 离线 · {err.slice(0, 48)}
        </div>
      ) : null}
    </div>
  );
}
