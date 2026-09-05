/**
 * Live right-rail files: FilesRail 树 + 只读文本预览。
 * 完整编辑请走项目模式 ProjectWorkbench。
 */
import { useCallback, useEffect, useState } from "react";
import { FilesRail } from "../wire/sidebar/FilesRail";
import { DraftMarkdown } from "../wire/DraftMarkdown";
import { useAppPorts } from "../ports";
import type { FsTreeNode } from "../markdown/api";
import { visiblePoll } from "./poll";

function flattenFsPaths(nodes: FsTreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === "file") acc.push(n.path);
    if (n.children?.length) flattenFsPaths(n.children, acc);
  }
  return acc;
}

const PREVIEW_OK = /\.(md|mdx|markdown|txt|json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|html|yml|yaml|toml|rs|go|py|svg|xml|sh)$/i;

function previewSource(path: string, content: string): string {
  if (/\.(md|mdx|markdown)$/i.test(path)) return content || "_(空文件)_";
  const fence = path.split(".").pop() || "text";
  return `\`\`\`${fence}\n${content || ""}\n\`\`\``;
}

export function LiveFilesRail() {
  const { fetchMdTree, fetchProjectTree, fetchGitStatus, readFsFile } =
    useAppPorts().files;
  const [paths, setPaths] = useState<string[]>([]);
  const [modifiedPaths, setModifiedPaths] = useState<string[]>([]);
  const [diff, setDiff] = useState({ add: 0, del: 0, file: "—" });
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      let tree;
      try {
        ({ tree } = await fetchProjectTree());
      } catch {
        ({ tree } = await fetchMdTree());
      }
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
      try {
        const st = await fetchGitStatus();
        setModifiedPaths(st.files.map((f) => f.path));
        setDiff({
          add: st.add,
          del: st.del,
          file: st.files[0]?.path || next[0] || "—",
        });
      } catch {
        setModifiedPaths([]);
        setDiff({ add: 0, del: 0, file: next[0] || "—" });
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPaths((prev) => (prev.length === 0 ? prev : []));
    }
  }, [fetchMdTree, fetchProjectTree, fetchGitStatus]);

  useEffect(() => {
    return visiblePoll(refresh, 8000);
  }, [refresh]);

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
  }, [openPath, readFsFile]);

  return (
    <div className="live-files-rail-stack" data-live-files-rail="true">
      <div className="live-files-tree">
        <FilesRail
          paths={paths}
          modifiedPaths={modifiedPaths}
          rootLabel="文件"
          diff={err ? { add: 0, del: 0, file: "offline" } : diff}
          onFileOpen={(p) => {
            if (PREVIEW_OK.test(p)) setOpenPath(p);
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
              <DraftMarkdown source={previewSource(openPath, content)} />
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
