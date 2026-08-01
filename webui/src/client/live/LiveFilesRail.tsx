/**
 * Live right-rail files: draft FilesRail chrome + real /api/fs/md-tree paths.
 * Selecting a file opens MarkdownWorkbench (live FS).
 */
import { useCallback, useEffect, useState } from "react";
import { FilesRail } from "../drafts/panels/FilesRail";
import { MarkdownWorkbench } from "../markdown";
import { fetchMdTree, type FsTreeNode } from "../markdown/api";

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
      setPaths(flattenFsPaths(tree));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPaths([]);
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
          onFileOpen={(p) => setOpenPath(p)}
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
          <MarkdownWorkbench
            openPath={openPath}
            onOpenConsumed={() => {
              /* keep path selected for re-open */
            }}
          />
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
