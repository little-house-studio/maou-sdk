import { useEffect, useMemo, useState } from "react";
import {
  buildFileTree,
  defaultExpandedPaths,
  type FileIconKind,
  type FileTreeNode,
} from "../file-tree";
import { fileMarkKind, hierarchyIndentPx } from "../visual-marks";
import { FileMark } from "../icons/Marks";

export type FilesRailProps = {
  paths: string[];
  modifiedPaths?: string[];
  rootLabel?: string;
  diff?: { add: number; del: number; file: string };
  /** Optional: file open for live shell (draft ignores). */
  onFileOpen?: (path: string) => void;
};

const DEFAULT_DIFF = { add: 24, del: 8, file: "DraftShell.tsx" };

function TreeRow({
  node,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isFolder = node.kind === "folder";
  const isOpen = isFolder && expanded.has(node.path);
  const icon: FileIconKind = fileMarkKind(node.name, isFolder, isOpen);
  const isSelected = selected === node.path;

  return (
    <>
      <div
        className={`vsc-tree-row kind-${icon}${isSelected ? " is-selected" : ""}${
          node.modified ? " is-modified" : ""
        }${isFolder ? " is-folder" : " is-file"}`}
        style={{ paddingLeft: hierarchyIndentPx(depth, 14, 8) }}
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
        aria-selected={isSelected}
        title={node.path}
        onClick={() => {
          if (isFolder) onToggle(node.path);
          onSelect(node.path);
        }}
      >
        <span
          className={`vsc-tree-twistie${isFolder ? "" : " is-leaf"}${
            isOpen ? " is-open" : ""
          }`}
          aria-hidden
        >
          {isFolder ? "▸" : ""}
        </span>
        <FileMark kind={icon} size={15} title={icon} decorative />
        <span className="vsc-tree-label">{node.name}</span>
        {node.modified ? (
          <span className="vsc-tree-mod" title="已修改">
            M
          </span>
        ) : null}
      </div>
      {isFolder && isOpen && node.children
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  );
}

/** 右侧文件栏：顶部 diff 图标摘要 + 类型/修改图标树 */
export function FilesRail({
  paths,
  modifiedPaths,
  rootLabel = "文件",
  diff = DEFAULT_DIFF,
  onFileOpen,
}: FilesRailProps) {
  const marked = useMemo(() => {
    const mods = new Set(modifiedPaths ?? []);
    return paths.map((p) => (mods.has(p) ? `${p}\0M` : p));
  }, [paths, modifiedPaths]);
  const tree = useMemo(() => buildFileTree(marked), [marked]);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    defaultExpandedPaths(buildFileTree(paths)),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const pathsKey = paths.join("\n");

  // Only re-seed expand when path *set* changes — not every poll with same paths
  // (LiveFilesRail refreshes md-tree every few seconds; resetting expand caused flicker).
  useEffect(() => {
    setExpanded((prev) => {
      const defaults = defaultExpandedPaths(buildFileTree(paths));
      const pathSet = new Set(paths);
      // Keep user expand state for paths still present; open new folders by default
      const next = new Set<string>();
      for (const p of prev) {
        if (pathSet.has(p) || [...pathSet].some((x) => x.startsWith(p + "/"))) {
          next.add(p);
        }
      }
      for (const p of defaults) next.add(p);
      if (next.size === prev.size && [...next].every((p) => prev.has(p))) {
        return prev;
      }
      return next;
    });
    setSelected((sel) => (sel && paths.includes(sel) ? sel : null));
  }, [pathsKey, paths]);

  const onToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onSelect = (path: string) => {
    setSelected(path);
    // Only open files (not folders) for live host
    if (onFileOpen && !path.endsWith("/")) {
      onFileOpen(path);
    }
  };

  return (
    <div className="panel draft-rail-panel vsc-explorer wire-files-panel">
      <div className="wire-files-head">
        <div className="wire-files-title">{rootLabel}</div>
        <div className="wire-diff-strip" aria-label="diff 信息">
          <span className="wire-diff-file" title={diff.file}>
            {diff.file}
          </span>
          {diff.add !== 0 || diff.del !== 0 ? (
            <>
              <span className="wire-diff-stat add">+{diff.add}</span>
              <span className="wire-diff-stat del">−{diff.del}</span>
            </>
          ) : null}
        </div>
      </div>
      {tree.length === 0 ? (
        <div className="draft-file-empty">无文件</div>
      ) : (
        <div className="vsc-explorer-body">
          <div className="vsc-tree" role="tree" aria-label="文件树">
            {tree.map((node) => (
              <TreeRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
