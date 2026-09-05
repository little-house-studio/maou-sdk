import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  childrenOf,
  deriveAncestry,
  descendantStats,
  type SessionTreeNode,
} from "./session-ancestry";

export type SessionTreeCrumbsProps = {
  sessions: SessionTreeNode[];
  activeSessionId: string | null;
  runningSessionIds?: readonly string[];
  onSelect: (sessionId: string) => void;
  onFork?: (parentId: string) => void;
  onNewChild?: (parentId: string) => void;
};

function StateDot({
  running,
  lamp,
}: {
  running: boolean;
  lamp?: string;
}) {
  const kind = lamp || (running ? "running" : "idle");
  return (
    <span
      className={`wire-session-tree-dot is-${kind}${running ? " is-run" : ""}`}
      aria-hidden
    />
  );
}

function Chevron({
  className = "",
}: {
  className?: string;
}) {
  return (
    <svg
      className={`wire-session-tree-chevron ${className}`.trim()}
      viewBox="0 0 14 14"
      width="14"
      height="14"
      aria-hidden
    >
      <path
        d="M3.2 5.2L7 9l3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function activityLabel(node: SessionTreeNode, running: boolean): string {
  if (running || node.lamp === "running") return "运行中";
  if (node.lamp === "await_approval") return "待审批";
  if (node.lamp === "plan_review") return "计划审阅";
  if (node.lamp === "await_ask") return "待回答";
  if (node.lamp === "helpers") {
    return node.helperCount ? `助手 · ${node.helperCount}` : "助手";
  }
  if (node.lamp === "done") return "已完成";
  return "闲置";
}

function catalogItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      '[role="treeitem"]:not([aria-disabled="true"])',
    ),
  );
}

/**
 * 对话顶栏：祖先链用 / 连接；有后代时在标题后挂 /N 目录树。
 */
export function SessionTreeCrumbs({
  sessions,
  activeSessionId,
  runningSessionIds = [],
  onSelect,
  onFork,
  onNewChild,
}: SessionTreeCrumbsProps) {
  const ancestry = useMemo(
    () => deriveAncestry(sessions, activeSessionId),
    [sessions, activeSessionId],
  );
  const running = useMemo(
    () => new Set(runningSessionIds),
    [runningSessionIds],
  );
  const stats = useMemo(
    () =>
      activeSessionId
        ? descendantStats(sessions, activeSessionId, running)
        : { count: 0, runningCount: 0 },
    [sessions, activeSessionId, running],
  );

  if (!activeSessionId || ancestry.length === 0) return null;

  return (
    <header className="wire-session-tree" data-session-tree="crumbs">
      <div className="wire-session-tree-row">
        <div className="wire-session-tree-cluster">
          <nav className="wire-session-tree-crumbs" aria-label="会话层级">
            {ancestry.map((node, index) => {
              const last = index === ancestry.length - 1;
              return (
                <span key={node.id} className="wire-session-tree-seg">
                  {index > 0 ? (
                    <span className="wire-session-tree-sep" aria-hidden>
                      /
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`wire-session-tree-crumb${last ? " is-current" : ""}`}
                    aria-current={last ? "page" : undefined}
                    title={node.title}
                    disabled={last}
                    onClick={() => onSelect(node.id)}
                  >
                    {node.title || node.id}
                  </button>
                </span>
              );
            })}
          </nav>
          {stats.count > 0 ? (
            <SessionDescendantCatalog
              sessions={sessions}
              parentId={activeSessionId}
              stats={stats}
              running={running}
              onSelect={onSelect}
            />
          ) : null}
        </div>

        <div className="wire-session-tree-acts">
          {onFork ? (
            <button
              type="button"
              className="wire-session-tree-act"
              onClick={() => onFork(activeSessionId)}
            >
              派生
            </button>
          ) : null}
          {onNewChild ? (
            <button
              type="button"
              className="wire-session-tree-act"
              onClick={() => onNewChild(activeSessionId)}
            >
              新建子会话
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function SessionDescendantCatalog({
  sessions,
  parentId,
  stats,
  running,
  onSelect,
}: {
  sessions: SessionTreeNode[];
  parentId: string;
  stats: { count: number; runningCount: number };
  running: Set<string>;
  onSelect: (id: string) => void;
}) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    minWidth: number;
  } | null>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setExpanded(new Set());
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }, []);

  const updatePos = useCallback(() => {
    const trig = triggerRef.current;
    if (!trig) return;
    const r = trig.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const menuH = menuRef.current?.offsetHeight ?? 240;
    const gap = 5;
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < menuH + gap && spaceAbove > spaceBelow;
    let top = openUp ? r.top - gap - menuH : r.bottom + gap;
    top = Math.max(
      8,
      Math.min(top, window.innerHeight - 8 - Math.min(menuH, window.innerHeight - 16)),
    );
    let left = r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({
      left,
      top,
      minWidth: Math.max(r.width, 240),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
    const id = requestAnimationFrame(() => updatePos());
    return () => cancelAnimationFrame(id);
  }, [open, expanded, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePos();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const focusAt = (index: number) => {
    const items = catalogItems(menuRef.current);
    if (items.length === 0) return;
    items[(index + items.length) % items.length]?.focus();
  };

  const navigate = (event: React.KeyboardEvent) => {
    const items = catalogItems(menuRef.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(items.length - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index < 0 ? items.length - 1 : index - 1);
    }
  };

  const toggleBranch = (id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) {
        const drop = (pid: string) => {
          next.delete(pid);
          for (const child of childrenOf(sessions, pid)) drop(child.id);
        };
        drop(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const pick = (id: string) => {
    onSelect(id);
    close();
  };

  const kids = childrenOf(sessions, parentId);
  const reserveDisclosure = kids.some(
    (k) => childrenOf(sessions, k.id).length > 0,
  );
  const countLabel =
    stats.runningCount > 0
      ? `${stats.runningCount} 个子会话运行中，共 ${stats.count} 个`
      : `${stats.count} 个子会话`;

  const menu =
    open && typeof document !== "undefined" ? (
      <div
        ref={menuRef}
        id={`${uid}-tree`}
        className="wire-session-tree-menu"
        role="tree"
        aria-label="子会话"
        data-session-catalog=""
        onKeyDown={navigate}
        style={
          pos
            ? {
                position: "fixed",
                left: pos.left,
                top: pos.top,
                minWidth: pos.minWidth,
                zIndex: 10050,
              }
            : {
                position: "fixed",
                left: -9999,
                top: 0,
                visibility: "hidden",
                zIndex: 10050,
              }
        }
      >
        {kids.length === 0 ? (
          <div className="wire-session-tree-empty">没有子会话</div>
        ) : (
          kids.map((child) => (
            <CatalogNode
              key={child.id}
              node={child}
              sessions={sessions}
              running={running}
              expanded={expanded}
              level={1}
              reserveDisclosure={reserveDisclosure}
              onToggle={toggleBranch}
              onPick={pick}
            />
          ))
        )}
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={`wire-session-tree-catalog${open ? " is-open" : ""}`}
      data-session-catalog-root=""
    >
      <button
        ref={triggerRef}
        type="button"
        className="wire-session-tree-count"
        data-session-count=""
        aria-haspopup="tree"
        aria-expanded={open}
        aria-controls={`${uid}-tree`}
        aria-label={countLabel}
        title={countLabel}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (!next) setExpanded(new Set());
            return next;
          });
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          if (!open) setOpen(true);
          queueMicrotask(() => focusAt(0));
        }}
      >
        <span className="wire-session-tree-sep" aria-hidden>
          /
        </span>
        <span className="wire-session-tree-activity">
          {stats.runningCount > 0 ? (
            <StateDot running lamp="running" />
          ) : null}
        </span>
        <span className="wire-session-tree-count-num">{stats.count}</span>
        <Chevron className={open ? "is-open" : ""} />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

function CatalogNode({
  node,
  sessions,
  running,
  expanded,
  level,
  reserveDisclosure,
  onToggle,
  onPick,
}: {
  node: SessionTreeNode;
  sessions: SessionTreeNode[];
  running: Set<string>;
  expanded: Set<string>;
  level: number;
  reserveDisclosure: boolean;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
}) {
  const kids = childrenOf(sessions, node.id);
  const hasKids = kids.length > 0;
  const open = expanded.has(node.id);
  const isRun = running.has(node.id) || node.lamp === "running";
  const childReserve = kids.some((k) => childrenOf(sessions, k.id).length > 0);

  return (
    <div className="wire-session-tree-node">
      <div
        role="treeitem"
        tabIndex={0}
        aria-level={level}
        aria-expanded={hasKids ? open : undefined}
        className="wire-session-tree-row-item"
        onClick={() => onPick(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPick(node.id);
          } else if (event.key === "ArrowRight" && hasKids) {
            event.preventDefault();
            if (!open) onToggle(node.id);
          } else if (event.key === "ArrowLeft" && hasKids && open) {
            event.preventDefault();
            onToggle(node.id);
          }
        }}
      >
        {reserveDisclosure ? (
          hasKids ? (
            <button
              type="button"
              className={`wire-session-tree-twist${open ? " is-open" : ""}`}
              aria-label={open ? `收起 ${node.title}` : `展开 ${node.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.id);
              }}
            >
              <Chevron />
            </button>
          ) : (
            <span className="wire-session-tree-twist-space" aria-hidden />
          )
        ) : null}
        <StateDot running={isRun} lamp={node.lamp} />
        <span className="wire-session-tree-node-body">
          <span className="wire-session-tree-node-title">
            {node.title || node.id}
          </span>
          <span className="wire-session-tree-node-meta">
            {activityLabel(node, isRun)}
          </span>
        </span>
      </div>
      {hasKids && open ? (
        <div className="wire-session-tree-kids" role="group">
          {kids.map((child) => (
            <CatalogNode
              key={child.id}
              node={child}
              sessions={sessions}
              running={running}
              expanded={expanded}
              level={level + 1}
              reserveDisclosure={childReserve}
              onToggle={onToggle}
              onPick={onPick}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
