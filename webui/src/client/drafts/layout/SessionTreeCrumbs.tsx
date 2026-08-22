import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  childrenOf,
  deriveAncestry,
  descendantCount,
  type SessionTreeNode,
} from "../session-ancestry";

export type SessionTreeCrumbsProps = {
  sessions: SessionTreeNode[];
  activeSessionId: string | null;
  runningSessionIds?: readonly string[];
  onSelect: (sessionId: string) => void;
};

function Chevron({ open, className }: { open?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d={open ? "M4 6.5 L8 10.5 L12 6.5" : "M6 4 L10 8 L6 12"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StateDot({ running }: { running: boolean }) {
  return (
    <span
      className={`wire-session-tree-dot${running ? " is-run" : ""}`}
      aria-hidden
    />
  );
}

type MenuState = { parentId: string } | null;

/**
 * 对话顶栏横向祖先链 + 点击展开多级子会话树。
 * 对齐 DSH ConversationSessionHeader crumbs + SubagentCatalogAction。
 */
export function SessionTreeCrumbs({
  sessions,
  activeSessionId,
  runningSessionIds = [],
  onSelect,
}: SessionTreeCrumbsProps) {
  const ancestry = useMemo(
    () => deriveAncestry(sessions, activeSessionId),
    [sessions, activeSessionId],
  );
  const running = useMemo(
    () => new Set(runningSessionIds),
    [runningSessionIds],
  );
  const [menu, setMenu] = useState<MenuState>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMenu(null);
    setExpanded(new Set());
  }, [activeSessionId]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (ev: PointerEvent) => {
      if (
        ev.target instanceof Node &&
        !rootRef.current?.contains(ev.target)
      ) {
        setMenu(null);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!activeSessionId || ancestry.length === 0) return null;

  const currentDescendants = descendantCount(sessions, activeSessionId);
  const openMenu = (parentId: string) => {
    setExpanded(new Set());
    setMenu((prev) => (prev?.parentId === parentId ? null : { parentId }));
  };

  const select = (id: string) => {
    setMenu(null);
    if (id !== activeSessionId) onSelect(id);
  };

  const toggleBranch = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      className="wire-session-tree"
      ref={rootRef}
      data-session-tree="crumbs"
    >
      <nav className="wire-session-tree-crumbs" aria-label="会话层级">
        {ancestry.map((node, index) => {
          const last = index === ancestry.length - 1;
          const kids = childrenOf(sessions, node.id);
          const hasKids = kids.length > 0;
          const menuOpen = menu?.parentId === node.id;
          return (
            <span key={node.id} className="wire-session-tree-seg">
              {index > 0 ? (
                <span className="wire-session-tree-sep" aria-hidden>
                  /
                </span>
              ) : null}
              <button
                type="button"
                className={`wire-session-tree-crumb${
                  last ? " is-current" : ""
                }${menuOpen ? " is-open" : ""}`}
                aria-current={last ? "page" : undefined}
                aria-haspopup={hasKids || !last ? "tree" : undefined}
                aria-expanded={hasKids || !last ? menuOpen : undefined}
                title={node.title}
                onClick={() => {
                  if (hasKids || !last) openMenu(node.id);
                }}
              >
                {node.title || node.id}
              </button>
              {hasKids ? (
                <button
                  type="button"
                  className={`wire-session-tree-chevron${
                    menuOpen ? " is-open" : ""
                  }`}
                  aria-label={`展开 ${node.title} 的子会话`}
                  onClick={() => openMenu(node.id)}
                >
                  <Chevron open={menuOpen} />
                </button>
              ) : null}
            </span>
          );
        })}
      </nav>

      {currentDescendants > 0 ? (
        <button
          type="button"
          className={`wire-session-tree-count${
            menu?.parentId === activeSessionId ? " is-open" : ""
          }`}
          aria-haspopup="tree"
          aria-expanded={menu?.parentId === activeSessionId}
          aria-label={`${currentDescendants} 个子会话`}
          onClick={() => openMenu(activeSessionId)}
        >
          {currentDescendants} 个子会话
          <Chevron open={menu?.parentId === activeSessionId} />
        </button>
      ) : null}

      {menu ? (
        <div
          className="wire-session-tree-menu"
          role="tree"
          aria-label="子会话"
        >
          {menu.parentId !== activeSessionId ? (
            <button
              type="button"
              className="wire-session-tree-row is-jump"
              role="treeitem"
              onClick={() => select(menu.parentId)}
            >
              打开此会话
            </button>
          ) : null}
          <CatalogRows
            parentId={menu.parentId}
            sessions={sessions}
            expanded={expanded}
            running={running}
            activeSessionId={activeSessionId}
            level={1}
            onSelect={select}
            onToggle={toggleBranch}
          />
        </div>
      ) : null}
    </div>
  );
}

function CatalogRows({
  parentId,
  sessions,
  expanded,
  running,
  activeSessionId,
  level,
  onSelect,
  onToggle,
}: {
  parentId: string;
  sessions: SessionTreeNode[];
  expanded: Set<string>;
  running: Set<string>;
  activeSessionId: string | null;
  level: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const kids = childrenOf(sessions, parentId);
  if (kids.length === 0) {
    return (
      <div className="wire-session-tree-empty" role="note">
        没有子会话
      </div>
    );
  }
  return (
    <>
      {kids.map((child) => {
        const grand = childrenOf(sessions, child.id);
        const isOpen = expanded.has(child.id);
        const isActive = child.id === activeSessionId;
        return (
          <div key={child.id} className="wire-session-tree-node">
            <div
              className={`wire-session-tree-row${
                isActive ? " is-active" : ""
              }`}
              role="treeitem"
              aria-level={level}
              aria-expanded={grand.length > 0 ? isOpen : undefined}
              tabIndex={0}
              onClick={() => onSelect(child.id)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onSelect(child.id);
                } else if (
                  ev.key === "ArrowRight" &&
                  grand.length > 0 &&
                  !isOpen
                ) {
                  ev.preventDefault();
                  onToggle(child.id);
                } else if (ev.key === "ArrowLeft" && isOpen) {
                  ev.preventDefault();
                  onToggle(child.id);
                }
              }}
            >
              {grand.length > 0 ? (
                <button
                  type="button"
                  className={`wire-session-tree-branch${
                    isOpen ? " is-open" : ""
                  }`}
                  tabIndex={-1}
                  aria-label={isOpen ? "收起下级" : "展开下级"}
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    onToggle(child.id);
                  }}
                >
                  <Chevron />
                </button>
              ) : (
                <span className="wire-session-tree-branch-space" />
              )}
              <StateDot running={running.has(child.id)} />
              <span className="wire-session-tree-label">{child.title}</span>
            </div>
            {isOpen && grand.length > 0 ? (
              <div className="wire-session-tree-children" role="group">
                <CatalogRows
                  parentId={child.id}
                  sessions={sessions}
                  expanded={expanded}
                  running={running}
                  activeSessionId={activeSessionId}
                  level={level + 1}
                  onSelect={onSelect}
                  onToggle={onToggle}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
