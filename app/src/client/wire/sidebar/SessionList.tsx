import React, { useMemo, useState, type ReactNode } from "react";
import type { DraftSession } from "../types";
import {
  flattenSessionForest,
  indexSessionTree,
  projectSessionRail,
  type SessionTreeGuide,
} from "../thread/session-ancestry";
import { t } from "../../i18n";
import { Fold } from "../../motion";
import { CascadeMenu, type CascadeItem } from "../menus/CascadeMenu";
import { ChromeMark, StatusMark } from "../icons/Marks";
import type { StatusMarkKind } from "../visual-marks";

export type SessionLampVisual =
  | "running"
  | "helpers"
  | "approval"
  | "plan"
  | "ask"
  | "fork"
  | "session";

export function sessionLampVisual(
  lamp: DraftSession["lamp"] | undefined,
  running: boolean,
  child: boolean,
): SessionLampVisual {
  if (lamp === "running" || running) return "running";
  if (lamp === "helpers") return "helpers";
  if (lamp === "await_approval") return "approval";
  if (lamp === "plan_review") return "plan";
  if (lamp === "await_ask") return "ask";
  return child ? "fork" : "session";
}

const LAMP_STATUS: Record<
  Exclude<SessionLampVisual, "plan" | "fork" | "session">,
  StatusMarkKind
> = {
  running: "running",
  helpers: "running",
  approval: "blocked",
  ask: "needs_reply",
};

function ForkMark({ size = 14, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="draft-mark"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="4.5" cy="3.6" r="1.55" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4.5" cy="12.4" r="1.55" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.6" cy="12.4" r="1.55" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4.5 5.2v5.5M4.5 8.1c.1 2.4 2.4 4.3 5.5 4.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SessionLamp({
  visual,
  title,
  className,
}: {
  visual: SessionLampVisual;
  title?: string;
  className: string;
}) {
  return (
    <span className={className} data-session-lamp={visual} title={title}>
      {visual === "session" ? (
        <ChromeMark kind="session" size={14} title={title} />
      ) : visual === "plan" ? (
        <ChromeMark kind="tasks" size={14} title={title} />
      ) : visual === "fork" ? (
        <ForkMark size={14} title={title} />
      ) : (
        <StatusMark
          kind={LAMP_STATUS[visual]}
          size={14}
          title={title}
          decorative={!title}
        />
      )}
    </span>
  );
}

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

export type SessionAgeGroup = "today" | "week" | "older";

const AGE_ORDER: SessionAgeGroup[] = ["today", "week", "older"];

const AGE_LABEL: Record<SessionAgeGroup, string> = {
  today: "session.group.today",
  week: "session.group.week",
  older: "session.group.older",
};

/** 用 timeLabel 粗分今天 / 近 7 天 / 更早；子会话跟父会话一组。 */
export function sessionAgeGroup(
  timeLabel: string,
  running = false,
): SessionAgeGroup {
  if (running) return "today";
  const s = timeLabel.trim();
  if (!s || /刚刚|just now|\d+分前|\d+m ago|\d+时前|\d+h ago/.test(s)) {
    return "today";
  }
  if (s === "昨天" || s === "yesterday") return "week";
  const day = s.match(/^(\d+)\s*(天前|d ago)$/);
  if (day) {
    const n = Number(day[1]);
    if (n <= 1) return "today";
    if (n < 7) return "week";
    return "older";
  }
  return "older";
}

export function groupSessionRail<T extends { node: DraftSession; depth: number }>(
  rows: T[],
  runningIds?: Iterable<string>,
): Array<{ group: SessionAgeGroup; rows: T[] }> {
  const running = new Set(runningIds ?? []);
  const buckets: Record<SessionAgeGroup, T[]> = {
    today: [],
    week: [],
    older: [],
  };
  let i = 0;
  while (i < rows.length) {
    const root = rows[i]!;
    const age = sessionAgeGroup(root.node.timeLabel, running.has(root.node.id));
    buckets[age].push(root);
    i += 1;
    while (i < rows.length && rows[i]!.depth > 0) {
      buckets[age].push(rows[i]!);
      i += 1;
    }
  }
  return AGE_ORDER.filter((g) => buckets[g].length > 0).map((g) => ({
    group: g,
    rows: buckets[g],
  }));
}

function newSessionHint(): string {
  if (typeof navigator === "undefined") return "⌘N";
  const plat = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad/i.test(plat) ? "⌘N" : "Ctrl+N";
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
 * 左侧会话轨：搜索井 / 新建动作行 / 日期分组 / 两行条目 + fork 树枝。
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
  const forestById = useMemo(() => {
    const map = new Map<
      string,
      { depth: number; guides: SessionTreeGuide[] }
    >();
    for (const row of flattenSessionForest(sessions)) {
      map.set(row.node.id, { depth: row.depth, guides: row.guides });
    }
    return map;
  }, [sessions]);
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
  const groups = useMemo(
    () => groupSessionRail(rows, runningSessionIds),
    [rows, runningSessionIds],
  );
  const shortcut = newSessionHint();

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
          <span className="wire-session-new-label">{t("session.new")}</span>
          <kbd className="wire-session-new-kbd">{shortcut}</kbd>
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
          groups.map(({ group, rows: grows }) => (
            <div key={group} className="wire-session-chunk">
              <div className="wire-session-group">{t(AGE_LABEL[group])}</div>
              {grows.map(({ node: s, depth, guides }) => {
                if (!filtering && depth > 0) return null;
                const kidCount = fullKids.get(s.id)?.length ?? 0;
                const expanded = !collapsedIds.has(s.id);
                return (
                  <React.Fragment key={s.id}>
                    <SessionRailRow
                      s={s}
                      depth={depth}
                      guides={guides}
                      kidCount={kidCount}
                      expanded={expanded}
                      filtering={filtering}
                      matchedIds={matchedIds}
                      activeId={activeId}
                      running={running}
                      onSelect={onSelect}
                      onRename={onRename}
                      onFork={onFork}
                      onNewChild={onNewChild}
                      onDelete={onDelete}
                      toggleFold={toggleFold}
                    />
                    {!filtering && kidCount > 0 ? (
                      <SessionKidFold
                        parentId={s.id}
                        open={expanded}
                        fullKids={fullKids}
                        forestById={forestById}
                        filtering={filtering}
                        matchedIds={matchedIds}
                        collapsedIds={collapsedIds}
                        activeId={activeId}
                        running={running}
                        onSelect={onSelect}
                        onRename={onRename}
                        onFork={onFork}
                        onNewChild={onNewChild}
                        onDelete={onDelete}
                        toggleFold={toggleFold}
                      />
                    ) : null}
                  </React.Fragment>
                );
              })}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function SessionRailRow({
  s,
  depth,
  guides,
  kidCount,
  expanded,
  filtering,
  matchedIds,
  activeId,
  running,
  onSelect,
  onRename,
  onFork,
  onNewChild,
  onDelete,
  toggleFold,
}: {
  s: DraftSession;
  depth: number;
  guides: SessionTreeGuide[];
  kidCount: number;
  expanded: boolean;
  filtering: boolean;
  matchedIds: Set<string>;
  activeId: string;
  running: Set<string>;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onFork?: (parentId: string) => void;
  onNewChild?: (parentId: string) => void;
  onDelete?: (id: string) => void;
  toggleFold: (id: string, expanded: boolean) => void;
}) {
  const keepOnly = filtering && !matchedIds.has(s.id);
  const isRun = running.has(s.id) || s.lamp === "running";
  const visual = sessionLampVisual(s.lamp, isRun, depth > 0);
  const markTitle =
    lampTitle(s, isRun) || (visual === "fork" ? t("session.fork") : "会话");
  const sub = lampTitle(s, isRun) || (isRun ? t("session.running") : s.timeLabel);
  return (
    <div
      className={`wire-session-row${s.id === activeId ? " active" : ""}${
        isRun ? " is-running" : ""
      }${depth > 0 ? " is-child" : ""}${keepOnly ? " is-filter-keep" : ""}`}
      data-depth={depth}
      role="option"
      aria-selected={s.id === activeId}
    >
      <SessionTreeGuides guides={guides} />
      {kidCount > 0 && !filtering ? (
        <button
          type="button"
          className={`wire-session-fold${expanded ? " is-open" : ""}`}
          data-open={expanded ? "" : undefined}
          title={expanded ? t("session.fold") : t("session.unfold")}
          aria-label={expanded ? t("session.fold") : t("session.unfold")}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            toggleFold(s.id, expanded);
          }}
        >
          <span className="wire-session-fold-chev" aria-hidden>
            ▾
          </span>
        </button>
      ) : null}
      <button
        type="button"
        className="wire-session-btn"
        onClick={() => onSelect(s.id)}
        onDoubleClick={onRename ? () => onRename(s.id, s.title) : undefined}
        title={
          s.messageCount != null ? `${s.title} · ${s.messageCount}` : s.title
        }
      >
        <SessionLamp
          visual={visual}
          title={markTitle}
          className={`wire-session-lamp is-${visual}`}
        />
        <span className="wire-session-copy">
          <span className="wire-session-title">{s.title}</span>
          <span className="wire-session-sub">
            <span className="wire-session-sub-text">{sub}</span>
            {s.messageCount != null ? (
              <span className="wire-session-count">{s.messageCount}</span>
            ) : null}
          </span>
        </span>
      </button>
      <SessionRowMore
        title={s.title}
        onRename={onRename ? () => onRename(s.id, s.title) : undefined}
        onFork={onFork ? () => onFork(s.id) : undefined}
        onNewChild={onNewChild ? () => onNewChild(s.id) : undefined}
        onDelete={onDelete ? () => onDelete(s.id) : undefined}
      />
    </div>
  );
}

function SessionKidFold({
  parentId,
  open,
  fullKids,
  forestById,
  filtering,
  matchedIds,
  collapsedIds,
  activeId,
  running,
  onSelect,
  onRename,
  onFork,
  onNewChild,
  onDelete,
  toggleFold,
}: {
  parentId: string;
  open: boolean;
  fullKids: Map<string, DraftSession[]>;
  forestById: Map<string, { depth: number; guides: SessionTreeGuide[] }>;
  filtering: boolean;
  matchedIds: Set<string>;
  collapsedIds: Set<string>;
  activeId: string;
  running: Set<string>;
  onSelect: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onFork?: (parentId: string) => void;
  onNewChild?: (parentId: string) => void;
  onDelete?: (id: string) => void;
  toggleFold: (id: string, expanded: boolean) => void;
}) {
  const kids = fullKids.get(parentId) ?? [];
  if (kids.length === 0) return null;
  return (
    <Fold open={open}>
      {kids.map((child) => {
        const layout = forestById.get(child.id);
        const depth = layout?.depth ?? 1;
        const guides = layout?.guides ?? [];
        const kidCount = fullKids.get(child.id)?.length ?? 0;
        const expanded = !collapsedIds.has(child.id);
        return (
          <React.Fragment key={child.id}>
            <SessionRailRow
              s={child}
              depth={depth}
              guides={guides}
              kidCount={kidCount}
              expanded={expanded}
              filtering={filtering}
              matchedIds={matchedIds}
              activeId={activeId}
              running={running}
              onSelect={onSelect}
              onRename={onRename}
              onFork={onFork}
              onNewChild={onNewChild}
              onDelete={onDelete}
              toggleFold={toggleFold}
            />
            {kidCount > 0 ? (
              <SessionKidFold
                parentId={child.id}
                open={expanded}
                fullKids={fullKids}
                forestById={forestById}
                filtering={filtering}
                matchedIds={matchedIds}
                collapsedIds={collapsedIds}
                activeId={activeId}
                running={running}
                onSelect={onSelect}
                onRename={onRename}
                onFork={onFork}
                onNewChild={onNewChild}
                onDelete={onDelete}
                toggleFold={toggleFold}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </Fold>
  );
}

function SessionRowMore({
  title,
  onRename,
  onFork,
  onNewChild,
  onDelete,
}: {
  title: string;
  onRename?: () => void;
  onFork?: () => void;
  onNewChild?: () => void;
  onDelete?: () => void;
}) {
  const items: CascadeItem[] = [];
  if (onRename) items.push({ id: "rename", label: t("session.rename"), onSelect: onRename });
  if (onFork) items.push({ id: "fork", label: t("session.fork"), onSelect: onFork });
  if (onNewChild) {
    items.push({ id: "child", label: t("session.newChild"), onSelect: onNewChild });
  }
  if (onDelete) {
    items.push({
      id: "delete",
      label: t("session.delete"),
      danger: true,
      onSelect: onDelete,
    });
  }
  if (items.length === 0) return null;
  return (
    <div
      className="wire-session-more-host"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <CascadeMenu
        className="wire-session-more"
        triggerClassName="wire-session-more-btn"
        triggerLabel="⋯"
        triggerTitle={t("session.more")}
        ariaLabel={`${t("session.more")} ${title}`}
        columns={[{ key: "acts", items }]}
      />
    </div>
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
