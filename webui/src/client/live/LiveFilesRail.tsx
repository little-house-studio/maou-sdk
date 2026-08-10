/**
 * Live right-rail files: FilesRail 树 + 只读 Markdown 预览。
 * 完整编辑请走项目模式 ProjectWorkbench。
 */
import { useCallback, useEffect, useState } from "react";
import { FilesRail } from "../drafts/panels/FilesRail";
import { DraftMarkdown } from "../drafts/DraftMarkdown";
import { fetchMdTree, readFsFile, type FsTreeNode } from "../markdown/api";

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
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
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

  // 打开路径变化 → 拉正文做只读预览
  useEffect(() => {
    if (!openPath) {
      setContent("");
      setPreviewErr(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPreviewErr(null);
    void (async () => {
      try {
        const f = await readFsFile(openPath);
        if (!cancelled) {
          setContent(f.content ?? "");
          setPreviewErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setContent("");
          setPreviewErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openPath]);

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
            // 仅 md 开只读预览；文件夹只展开
            if (/\.(md|mdx|markdown)$/i.test(p)) setOpenPath(p);
          }}
        />
      </div>
      {openPath ? (
        <div
          className="live-files-preview"
          data-live-files-preview={openPath}
        >
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
          {loading ? (
            <div className="live-files-err" data-live-files-loading="true">
              加载预览…
            </div>
          ) : previewErr ? (
            <div className="live-files-err" title={previewErr}>
              读取失败 · {previewErr.slice(0, 80)}
            </div>
          ) : (
            <div className="live-files-preview-body wire-project-preview">
              <DraftMarkdown source={content || "_(空文件)_"} />
            </div>
          )}
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
