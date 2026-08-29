import React, { useMemo, useState, type ReactNode } from "react";
import type { DraftSession } from "../types";
import {
  indexSessionTree,
  projectSessionRail,
  type SessionTreeGuide,
} from "../session-ancestry";
import { t } from "../../i18n";

export type SessionListHit = {
  key: string;
  sessionId: string;
  snippet: string;
};

export type SessionListProps = {
  /** Sessions for the currently selected agent only */
  sessions: DraftSession[];
  activeId: string;
  /** Active agent display name for empty/aria hint */
  agentLabel?: string;
  busy?: boolean;
  /** Session ids currently generating (icon color) */
  runningSessionIds?: string[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onFork?: (parentId: string) => void;
  onNewChild?: (parentId: string) => void;
  onRename?: (id: string, title: string) => void;
  /** 受控检索；不传则列表自己记 */
  query?: string;
  onQueryChange?: (q: string) => void;
  /** 正文检索命中；ChatPanel 写，本列表点选跳会话 */
  searchHits?: SessionListHit[];
  className?: string;
};

function highlightSnippet(text: string): ReactNode {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) =>
    p.startsWith("[") && p.endsWith("]") && p.length > 2 ? (
      <mark key={i}>{p.slice(1, -1)}</mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function lampTitle(s: DraftSession, running: boolean): string | undefined {
  if (s.lamp === "helpers" && s.helperCount) {
    return `${t("session.lamp.helpers")} ${s.helperCount}`;
  }
  if (s.lamp === "running" || running) return t("session.lamp.running");
  if (s.lamp === "await_approval") return t("session.lamp.approval");
  if (s.lamp === "plan_review") return t("session.lamp.plan");
  if (s.lamp === "await_ask") return t("session.lamp.ask");
  if (s.lamp === "done") return t("session.lamp.done");
  return undefined;
}

/**
 * 左侧会话轨：搜索井 / 新建动作行 / 树列表 + parent/fork 树枝。
 * draft-slots 与 ChatPanel ThreadRail 共用。
 */
export function SessionList({
  sessions,
  activeId,
  agentLabel,
  busy,
  runningSessionIds = [],
  onSelect,
  onNew,
  onDelete,
  onFork,
  onNewChild,
  onRename,
  query,
  onQueryChange,
  searchHits,
  className,
}: SessionListProps) {
  const running = new Set(runningSessionIds);
  const [localQ, setLocalQ] = useState("");
  const [userOpen, setUserOpen] = useState<Set<string>>(() => new Set());
  const [userFold, setUserFold] = useState<Set<string>>(() => new Set());
  const q = query ?? localQ;
  const extraKeepIds = useMemo(
    () => new Set((searchHits ?? []).map((h) => h.sessionId)),
    [searchHits],
  );
  const { children: fullKids } = useMemo(
    () => indexSessionTree(sessions),
    [sessions],
  );
  const { rows, matchedIds, filtering, collapsedIds } = useMemo(
    () =>
      projectSessionRail(sessions, {
        query: q,
        extraKeepIds,
        activeId,
        userOpen,
        userFold,
      }),
    [sessions, q, extraKeepIds, activeId, userOpen, userFold],
  );

  const setQ = (next: string) => {
    onQueryChange?.(next);
    if (query === undefined) setLocalQ(next);
  };

  const toggleFold = (id: string, expanded: boolean) => {
    if (expanded) {
      setUserFold((prev) => new Set(prev).add(id));
      setUserOpen((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    } else {
      setUserOpen((prev) => new Set(prev).add(id));
      setUserFold((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const emptyText =
    sessions.length === 0
      ? t("session.empty")
      : t("session.noneMatch");

  return (
    <section
      className={`wire-session-list${busy ? " is-busy" : ""}${
        running.size > 0 ? " has-running" : ""
      }${className ? ` ${className}` : ""}`}
      aria-label={agentLabel ? `${agentLabel} 的会话` : "会话列表"}
    >
      <div className="wire-session-search">
        <div className="wire-session-qwrap">
          <input
            type="text"
            role="searchbox"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("session.search")}
            aria-label={t("session.search")}
          />
        </div>
      </div>
      <div className="wire-new-task-wrap">
        <button
          type="button"
          className="wire-new-task-btn"
          onClick={onNew}
          aria-label={t("session.new")}
        >
          <span className="wire-session-new-plus" aria-hidden>
            +
          </span>
          {t("session.new")}
        </button>
      </div>
      {searchHits && searchHits.length > 0 ? (
        <div className="wire-session-hits">
          {searchHits.map((h) => (
            <button
              key={h.key}
              type="button"
              className="wire-session-hit"
              onClick={() => onSelect(h.sessionId)}
            >
              {highlightSnippet(h.snippet)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="wire-session-scroll" role="listbox" aria-label="会话">
        {rows.length === 0 ? (
          <div className="wire-empty-row">{emptyText}</div>
        ) : (
          rows.map(({ node: s, depth, guides }) => {
            const kidCount = fullKids.get(s.id)?.length ?? 0;
            const expanded = !collapsedIds.has(s.id);
            const keepOnly = filtering && !matchedIds.has(s.id);
            return (
              <div
                key={s.id}
                className={`wire-session-row${s.id === activeId ? " active" : ""}${
                  running.has(s.id) ? " is-running" : ""
                }${depth > 0 ? " is-child" : ""}${
                  keepOnly ? " is-filter-keep" : ""
                }`}
                data-depth={depth}
                role="option"
                aria-selected={s.id === activeId}
              >
                <SessionTreeGuides guides={guides} />
                {kidCount > 0 && !filtering ? (
                  <button
                    type="button"
                    className={`wire-session-fold${expanded ? " is-open" : ""}`}
                    title={
                      expanded ? t("session.fold") : t("session.unfold")
                    }
                    aria-label={
                      expanded ? t("session.fold") : t("session.unfold")
                    }
                    aria-expanded={expanded}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFold(s.id, expanded);
                    }}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wire-session-btn"
                  onClick={() => onSelect(s.id)}
                  onDoubleClick={
                    onRename ? () => onRename(s.id, s.title) : undefined
                  }
                  title={s.title}
                >
                  <span
                    className={`wire-session-lamp is-${s.lamp ?? (running.has(s.id) ? "running" : "idle")}`}
                    title={lampTitle(s, running.has(s.id))}
                    aria-hidden
                  />
                  <span className="wire-session-title">{s.title}</span>
                  <span className="wire-session-time">
                    {s.lamp === "running" || running.has(s.id)
                      ? t("session.running")
                      : s.timeLabel}
                  </span>
                </button>
                {onFork ? (
                  <button
                    type="button"
                    className="wire-session-fork"
                    title="派生"
                    aria-label={`派生 ${s.title}`}
                    onClick={() => onFork(s.id)}
                  >
                    派生
                  </button>
                ) : null}
                {onNewChild ? (
                  <button
                    type="button"
                    className="wire-session-child"
                    title="新建子会话"
                    aria-label={`新建 ${s.title} 的子会话`}
                    onClick={() => onNewChild(s.id)}
                  >
                    子
                  </button>
                ) : null}
                {onDelete && (
                  <button
                    type="button"
                    className="wire-session-del"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(s.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function SessionTreeGuides({ guides }: { guides: SessionTreeGuide[] }) {
  if (guides.length === 0) return null;
  return (
    <span className="wire-session-guides" aria-hidden>
      {guides.map((g, i) => (
        <span
          key={`${g}-${i}`}
          className={`wire-session-guide is-${g}`}
          data-guide={g}
        />
      ))}
    </span>
  );
}
