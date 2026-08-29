import React, { useMemo, useState } from "react";
import {
  childrenOf,
  deriveAncestry,
  descendantCount,
  type SessionTreeNode,
} from "../session-ancestry";
import {
  CascadeMenu,
  type CascadeColumn,
} from "../panels/CascadeMenu";

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

/**
 * 对话顶栏：祖先链点选跳转；子会话走纸面多级菜单。
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

  if (!activeSessionId || ancestry.length === 0) return null;

  const childCount = descendantCount(sessions, activeSessionId);

  return (
    <div className="wire-session-tree" data-session-tree="crumbs">
      <nav className="wire-session-tree-crumbs" aria-label="会话层级">
        {ancestry.map((node, index) => {
          const last = index === ancestry.length - 1;
          return (
            <span key={node.id} className="wire-session-tree-seg">
              {index > 0 ? (
                <span className="wire-session-tree-sep" aria-hidden>
                  ›
                </span>
              ) : null}
              {last ? (
                <span
                  className="wire-session-tree-crumb is-current"
                  aria-current="page"
                  title={node.title}
                >
                  {node.title || node.id}
                </span>
              ) : (
                <button
                  type="button"
                  className="wire-session-tree-crumb"
                  title={node.title}
                  onClick={() => onSelect(node.id)}
                >
                  {node.title || node.id}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {childCount > 0 ? (
        <SessionChildCascade
          sessions={sessions}
          parentId={activeSessionId}
          activeSessionId={activeSessionId}
          running={running}
          childCount={childCount}
          onSelect={onSelect}
        />
      ) : null}

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
  );
}

function SessionChildCascade({
  sessions,
  parentId,
  activeSessionId,
  running,
  childCount,
  onSelect,
}: {
  sessions: SessionTreeNode[];
  parentId: string;
  activeSessionId: string | null;
  running: Set<string>;
  childCount: number;
  onSelect: (id: string) => void;
}) {
  const kids = childrenOf(sessions, parentId);
  const defaultHover =
    kids.find((k) => childrenOf(sessions, k.id).length > 0)?.id ??
    kids[0]?.id ??
    "";
  const [hoverId, setHoverId] = useState(defaultHover);
  const preview = kids.some((k) => k.id === hoverId)
    ? hoverId
    : defaultHover;
  const grand = preview ? childrenOf(sessions, preview) : [];
  const split = kids.some((k) => childrenOf(sessions, k.id).length > 0);
  const previewTitle =
    kids.find((k) => k.id === preview)?.title || "下级";

  const columns: CascadeColumn[] = [
    {
      key: "children",
      heading: "子会话",
      empty: "没有子会话",
      items: kids.map((child) => {
        const hasKids = childrenOf(sessions, child.id).length > 0;
        return {
          id: child.id,
          label: child.title || child.id,
          selected: child.id === activeSessionId,
          active: preview === child.id,
          trailing: hasKids ? ("arrow" as const) : null,
          dismiss: true,
          lead: (
            <StateDot running={running.has(child.id)} lamp={child.lamp} />
          ),
          onHover: () => setHoverId(child.id),
          onSelect: () => onSelect(child.id),
        };
      }),
    },
  ];

  if (split) {
    columns.push({
      key: "next",
      heading: previewTitle,
      empty: "没有下级",
      items: grand.map((child) => ({
        id: child.id,
        label: child.title || child.id,
        selected: child.id === activeSessionId,
        lead: <StateDot running={running.has(child.id)} lamp={child.lamp} />,
        onSelect: () => onSelect(child.id),
      })),
    });
  }

  return (
    <CascadeMenu
      className="wire-session-tree-cascade"
      triggerClassName="wire-session-tree-count"
      triggerLabel={`${childCount} 个子会话`}
      triggerTitle="查看子会话"
      ariaLabel="子会话"
      columns={columns}
      onOpen={() => setHoverId(defaultHover)}
    />
  );
}
