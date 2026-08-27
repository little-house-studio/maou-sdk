import { useState } from "react";
import type { FsTreeNode } from "../api";

export type FileTreeProps = {
  tree: FsTreeNode[];
  activePath?: string | null;
  projectRoot?: string;
  emptyText?: string;
  onOpen: (path: string) => void;
};

function TreeNode({
  node,
  active,
  onOpen,
  depth = 0,
}: {
  node: FsTreeNode;
  active?: string | null;
  onOpen: (path: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (node.type === "dir") {
    return (
      <div className="md-tree-dir">
        <button
          type="button"
          className="md-tree-row dir"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="md-tree-caret">{open ? "▾" : "▸"}</span>
          <span className="md-tree-name">{node.name}</span>
        </button>
        {open &&
          (node.children ?? []).map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              active={active}
              onOpen={onOpen}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={"md-tree-row file" + (active === node.path ? " active" : "")}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <span className="md-tree-icon">MD</span>
      <span className="md-tree-name">{node.name}</span>
    </button>
  );
}

/** 项目内 .md 文件树 */
export function FileTree({
  tree,
  activePath,
  projectRoot,
  emptyText = "项目内暂无 Markdown 文件",
  onOpen,
}: FileTreeProps) {
  return (
    <aside className="md-files">
      <div className="md-side-head">Files · .md</div>
      {projectRoot ? (
        <div className="md-root-hint" title={projectRoot}>
          {projectRoot}
        </div>
      ) : null}
      <div className="md-tree">
        {tree.length === 0 ? (
          <div className="term-empty">{emptyText}</div>
        ) : (
          tree.map((n) => (
            <TreeNode
              key={n.path}
              node={n}
              active={activePath}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </aside>
  );
}
