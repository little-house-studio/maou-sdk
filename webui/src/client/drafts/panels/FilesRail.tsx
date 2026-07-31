import { useEffect, useMemo, useState } from "react";
import {
  buildFileTree,
  defaultExpandedPaths,
  type FileIconKind,
  type FileTreeNode,
} from "../file-tree";
import { fileMarkKind, hierarchyIndentPx } from "../visual-marks";
import { ChromeMark, FileMark, ModifiedMark } from "../icons/Marks";

export type FilesRailProps = {
  paths: string[];
  rootLabel?: string;
  diff?: { add: number; del: number; file: string };
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
        className={`vsc-tree-row${isSelected ? " is-selected" : ""}${
          node.modified ? " is-modified" : ""
        }`}
        style={{ paddingLeft: hierarchyIndentPx(depth, 11, 4) }}
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
        aria-selected={isSelected}
        title={node.path}
        onClick={() => {
          if (isFolder) onToggle(node.path);
          onSelect(node.path);
        }}
      >
        <FileMark kind={icon} size={14} title={icon} />
        <span className="vsc-tree-label">{node.name}</span>
        {node.modified ? <ModifiedMark size={12} /> : null}
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
  rootLabel = "文件",
  diff = DEFAULT_DIFF,
}: FilesRailProps) {
  const tree = useMemo(() => buildFileTree(paths), [paths]);
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    defaultExpandedPaths(buildFileTree(paths)),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const pathsKey = paths.join("\n");

  useEffect(() => {
    setExpanded(defaultExpandedPaths(buildFileTree(paths)));
    setSelected(null);
  }, [pathsKey, paths]);

  const onToggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="panel draft-rail-panel vsc-explorer wire-files-panel">
      <div className="wire-files-head">
        <div className="wire-files-title wire-pane-title-with-icon">
          <ChromeMark kind="files" size={12} decorative />
          {rootLabel}
        </div>
        <div className="wire-diff-strip" aria-label="diff 信息">
          <span className="wire-diff-stat add">+{diff.add}</span>
          <span className="wire-diff-stat del">−{diff.del}</span>
          <span className="wire-diff-file" title={diff.file}>
            {diff.file}
          </span>
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
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
