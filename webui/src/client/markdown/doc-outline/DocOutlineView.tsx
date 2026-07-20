/**
 * 需求文档工作台 UI
 * 面向写 PRD / 对齐需求的人群：进度、筛选、钻取、验收任务可视化
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ROLE_LABEL,
  findSection,
  flattenSections,
  kindLabel,
  parseBodyOutline,
  parseDocTree,
  pathToSection,
  statusLabel,
  PRD_WRITING_TIPS,
} from "./parse-doc";
import type {
  BodyNode,
  DocSection,
  ReqPriority,
  ReqStatus,
  SectionRole,
} from "./types";

export type DocOutlineViewProps = {
  markdown: string;
  fileLabel?: string | null;
  onJumpLine?: (line: number) => void;
  onOpenInEditor?: (line: number) => void;
};

type FilterState = {
  q: string;
  priority: ReqPriority | "all";
  status: ReqStatus | "all";
  role: SectionRole | "all";
  incompleteOnly: boolean;
};

const DEFAULT_FILTER: FilterState = {
  q: "",
  priority: "all",
  status: "all",
  role: "all",
  incompleteOnly: false,
};

function matchFilter(s: DocSection, f: FilterState): boolean {
  if (f.priority !== "all" && s.priority !== f.priority) return false;
  if (f.status !== "all" && s.status !== f.status) return false;
  if (f.role !== "all" && s.role !== f.role) return false;
  if (f.incompleteOnly) {
    const open = s.stats.tasksOpen > 0 || s.stats.progress === null || s.stats.progress < 100;
    // 无任务且无正文无子级视为未完成骨架
    const hollow = !s.stats.hasBody && s.children.length === 0;
    if (!open && !hollow) {
      if (s.stats.progress === 100) return false;
    }
    if (s.stats.progress === 100 && s.stats.tasksOpen === 0 && !hollow) return false;
  }
  if (f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    const hay = `${s.title} ${s.displayTitle} ${s.reqId ?? ""} ${s.tags.join(" ")} ${s.body}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** 子树是否有任一节点命中（用于树过滤时保留路径） */
function treeVisible(s: DocSection, f: FilterState): boolean {
  if (s.level > 0 && matchFilter(s, f)) return true;
  return s.children.some((c) => treeVisible(c, f));
}

function ProgressBar({ value, thin }: { value: number | null; thin?: boolean }) {
  if (value == null) {
    return <span className="do-prog muted">{thin ? "—" : "无验收任务"}</span>;
  }
  return (
    <span className={"do-prog" + (thin ? " thin" : "")}>
      <span className="do-prog-track">
        <span
          className="do-prog-fill"
          style={{
            width: `${value}%`,
            background:
              value >= 100
                ? "var(--ok)"
                : value >= 50
                  ? "var(--accent-dim)"
                  : "var(--err)",
          }}
        />
      </span>
      <span className="do-prog-num">{value}%</span>
    </span>
  );
}

function MetaBadges({ s }: { s: DocSection }) {
  return (
    <span className="do-badges">
      {s.reqId ? <span className="do-badge id">{s.reqId}</span> : null}
      {s.priority ? (
        <span className={`do-badge pri pri-${s.priority}`}>{s.priority}</span>
      ) : null}
      {s.status ? (
        <span className={`do-badge st st-${s.status}`}>
          {statusLabel(s.status)}
        </span>
      ) : null}
      {s.role !== "other" && s.role !== "doc" ? (
        <span className="do-badge role">{ROLE_LABEL[s.role]}</span>
      ) : null}
      {s.tags.map((t) => (
        <span key={t} className="do-badge tag">
          #{t}
        </span>
      ))}
    </span>
  );
}

function SectionTree({
  section,
  activeId,
  depth,
  filter,
  onSelect,
  forceOpen,
}: {
  section: DocSection;
  activeId: string;
  depth: number;
  filter: FilterState;
  onSelect: (id: string) => void;
  forceOpen?: boolean;
}) {
  const visibleKids = section.children.filter((c) => treeVisible(c, filter));
  const selfHit = section.level === 0 || matchFilter(section, filter);
  const show = section.level === 0 || selfHit || visibleKids.length > 0;
  const [open, setOpen] = useState(depth < 2);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen, filter.q]);

  if (!show) return null;

  const hasKids = visibleKids.length > 0;
  const active = section.id === activeId;
  const isRoot = section.level === 0;

  return (
    <div className="do-tree-node">
      <div
        className={
          "do-tree-row" +
          (active ? " active" : "") +
          (isRoot ? " root" : "") +
          (section.stats.progress === 100 ? " done" : "") +
          (section.status === "blocked" ? " blocked" : "")
        }
        style={{ paddingLeft: 6 + depth * 10 }}
      >
        {hasKids ? (
          <button
            type="button"
            className="do-tree-caret"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="do-tree-caret spacer" />
        )}
        <button
          type="button"
          className="do-tree-label"
          onClick={() => onSelect(section.id)}
          title={section.title}
        >
          {isRoot ? (
            <span className="do-tree-lv doc">DOC</span>
          ) : (
            <span className={`do-tree-lv role-${section.role}`}>
              {ROLE_LABEL[section.role].slice(0, 2)}
            </span>
          )}
          <span className="do-tree-title">
            {section.displayTitle || section.title}
          </span>
          {section.priority ? (
            <span className={`do-mini pri-${section.priority}`}>
              {section.priority}
            </span>
          ) : null}
          {section.stats.progress != null ? (
            <span className="do-mini pct">{section.stats.progress}%</span>
          ) : null}
        </button>
      </div>
      {open &&
        hasKids &&
        visibleKids.map((c) => (
          <SectionTree
            key={c.id}
            section={c}
            activeId={activeId}
            depth={depth + 1}
            filter={filter}
            onSelect={onSelect}
            forceOpen={!!filter.q.trim()}
          />
        ))}
    </div>
  );
}

function BodyTree({
  nodes,
  onJump,
}: {
  nodes: BodyNode[];
  onJump?: (line: number) => void;
}) {
  if (!nodes.length) {
    return (
      <div className="do-empty-soft">
        本章暂无正文。可在标题下写说明，或用 <code>- [ ]</code> 写验收项。
      </div>
    );
  }
  return (
    <div className="do-body-tree">
      {nodes.map((n) => (
        <BodyTreeItem key={n.id} node={n} onJump={onJump} />
      ))}
    </div>
  );
}

function BodyTreeItem({
  node,
  onJump,
}: {
  node: BodyNode;
  onJump?: (line: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasKids = node.children.length > 0;

  return (
    <div className="do-body-item">
      <div
        className={`do-body-row kind-${node.kind}${node.kind === "task" ? (node.checked ? " task-done" : " task-open") : ""}`}
        style={{ paddingLeft: 8 + node.indent * 14 }}
      >
        {hasKids ? (
          <button
            type="button"
            className="do-tree-caret"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="do-tree-caret spacer" />
        )}
        {node.kind === "task" ? (
          <span className={"do-task-box" + (node.checked ? " on" : "")}>
            {node.checked ? "✓" : ""}
          </span>
        ) : (
          <span className="do-body-kind">{kindLabel(node.kind)}</span>
        )}
        {node.kind === "code" ? (
          <button
            type="button"
            className="do-body-code-head"
            onClick={() => onJump?.(node.lineStart)}
          >
            <span className="do-body-lang">{node.lang || "code"}</span>
            <span className="do-body-code-preview">
              {node.text.split("\n")[0]?.slice(0, 72) || "…"}
              {node.text.includes("\n") ? " …" : ""}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="do-body-text"
            onClick={() => onJump?.(node.lineStart)}
            title={`L${node.lineStart + 1}`}
          >
            {node.text || " "}
          </button>
        )}
      </div>
      {node.kind === "code" && (
        <pre
          className="do-code-block"
          style={{ marginLeft: 8 + node.indent * 14 + 28 }}
        >
          <code>{node.text}</code>
        </pre>
      )}
      {open &&
        hasKids &&
        node.children.map((c) => (
          <BodyTreeItem key={c.id} node={c} onJump={onJump} />
        ))}
    </div>
  );
}

function ChildCard({
  s,
  onEnter,
}: {
  s: DocSection;
  onEnter: () => void;
}) {
  return (
    <button type="button" className="do-child-card" onClick={onEnter}>
      <div className="do-child-top">
        <span className={`do-role-pill role-${s.role}`}>
          {ROLE_LABEL[s.role]}
        </span>
        {s.priority ? (
          <span className={`do-badge pri pri-${s.priority}`}>{s.priority}</span>
        ) : null}
        {s.status ? (
          <span className={`do-badge st st-${s.status}`}>
            {statusLabel(s.status)}
          </span>
        ) : null}
      </div>
      <div className="do-child-name">
        {s.reqId ? <span className="do-req-inline">{s.reqId} </span> : null}
        {s.displayTitle}
      </div>
      <ProgressBar value={s.stats.progress} thin />
      <div className="do-child-meta">
        {s.stats.childCount ? `${s.stats.childCount} 子级` : "叶子"}
        {s.stats.tasksOpen + s.stats.tasksDone > 0
          ? ` · 任务 ${s.stats.tasksDone}/${s.stats.tasksOpen + s.stats.tasksDone}`
          : ""}
        {s.stats.hasCode ? " · 含代码" : ""}
        {" · "}L{s.lineStart + 1}
      </div>
    </button>
  );
}

export function DocOutlineView({
  markdown,
  fileLabel,
  onJumpLine,
  onOpenInEditor,
}: DocOutlineViewProps) {
  const parsed = useMemo(
    () =>
      parseDocTree(markdown, {
        fileLabel: fileLabel ?? "Document",
      }),
    [markdown, fileLabel],
  );

  const [focusId, setFocusId] = useState("sec-root");
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [showTips, setShowTips] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFocusId("sec-root");
    setFilter(DEFAULT_FILTER);
  }, [fileLabel]);

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) {
        return;
      }
      if (e.key === "Escape") {
        setFocusId((id) => {
          const path = pathToSection(parsed.root, id);
          if (path && path.length > 1) return path[path.length - 2]!.id;
          return id;
        });
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [parsed.root]);

  const focus = useMemo(
    () => findSection(parsed.root, focusId) ?? parsed.root,
    [parsed.root, focusId],
  );

  const crumbs = useMemo(
    () => pathToSection(parsed.root, focus.id) ?? [parsed.root],
    [parsed.root, focus.id],
  );

  const bodyNodes = useMemo(() => {
    const base = focus.level === 0 ? 0 : focus.lineStart + 1;
    return parseBodyOutline(focus.body, base);
  }, [focus]);

  const filteredChildren = useMemo(
    () => focus.children.filter((c) => treeVisible(c, filter)),
    [focus.children, filter],
  );

  /** 根视图：可展示的概览卡片（顶层章节） */
  const overviewCards = useMemo(() => {
    if (focus.level !== 0) return [];
    return focus.children.filter((c) => treeVisible(c, filter));
  }, [focus, filter]);

  const searchHits = useMemo(() => {
    if (!filter.q.trim() && filter.priority === "all" && filter.status === "all" && filter.role === "all" && !filter.incompleteOnly) {
      return null;
    }
    return flattenSections(parsed.root).filter((s) => matchFilter(s, filter));
  }, [parsed.root, filter]);

  const enter = (id: string) => setFocusId(id);
  const jump = (line: number) => {
    onJumpLine?.(line);
    onOpenInEditor?.(line);
  };

  const st = parsed.stats;
  const emptyDoc = !markdown.trim() || st.sectionCount === 0;

  return (
    <div className="do-app do-app-prd">
      {/* 顶部需求仪表盘 */}
      <header className="do-dash">
        <div className="do-dash-stats">
          <div className="do-stat">
            <span className="do-stat-v">{st.sectionCount}</span>
            <span className="do-stat-k">章节</span>
          </div>
          <div className="do-stat">
            <span className="do-stat-v">
              {st.tasksDone}
              <span className="do-stat-sub">/{st.tasksOpen + st.tasksDone}</span>
            </span>
            <span className="do-stat-k">验收任务</span>
          </div>
          <div className="do-stat">
            <span className="do-stat-v">
              {st.progress != null ? `${st.progress}%` : "—"}
            </span>
            <span className="do-stat-k">完成度</span>
          </div>
          <div className="do-stat">
            <span className="do-stat-v">{st.byPriority.P0 ?? 0}</span>
            <span className="do-stat-k">P0</span>
          </div>
          <div className="do-stat warn">
            <span className="do-stat-v">{st.byStatus.blocked ?? 0}</span>
            <span className="do-stat-k">阻塞</span>
          </div>
        </div>
        <div className="do-dash-tools">
          <input
            ref={searchRef}
            className="do-search"
            placeholder="搜索章节 / REQ / 正文…  (/)"
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          />
          <select
            className="do-select"
            value={filter.priority ?? "all"}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                priority: e.target.value as FilterState["priority"],
              }))
            }
          >
            <option value="all">优先级</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
          <select
            className="do-select"
            value={filter.status ?? "all"}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                status: e.target.value as FilterState["status"],
              }))
            }
          >
            <option value="all">状态</option>
            <option value="todo">待办</option>
            <option value="wip">进行中</option>
            <option value="done">完成</option>
            <option value="blocked">阻塞</option>
            <option value="draft">草稿</option>
          </select>
          <select
            className="do-select"
            value={filter.role}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                role: e.target.value as FilterState["role"],
              }))
            }
          >
            <option value="all">类型</option>
            {(Object.keys(ROLE_LABEL) as SectionRole[])
              .filter((r) => r !== "doc")
              .map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
          </select>
          <label className="do-check">
            <input
              type="checkbox"
              checked={filter.incompleteOnly}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  incompleteOnly: e.target.checked,
                }))
              }
            />
            未完成
          </label>
          <button
            type="button"
            className="linkish"
            onClick={() => setShowTips((v) => !v)}
          >
            {showTips ? "收起技巧" : "写作技巧"}
          </button>
        </div>
      </header>

      {showTips || emptyDoc ? (
        <div className="do-tips">
          <strong>写需求小抄</strong>
          <ul>
            {PRD_WRITING_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <pre className="do-tips-sample">{`# 项目需求

## 背景
…

## 目标
…

## [P0] REQ-001 用户登录 [WIP] #auth
作为用户，我希望…
### 验收标准
- [ ] 正确密码可进入首页
- [ ] 错误密码有提示
- [x] 登录页 UI 定稿

## [P1] REQ-002 支付
…`}</pre>
        </div>
      ) : null}

      <div className="do-body-layout">
        <div className="do-main">
          <div className="do-toolbar">
            <nav className="do-crumbs" aria-label="breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c.id} className="do-crumb-wrap">
                  {i > 0 ? <span className="do-crumb-sep">/</span> : null}
                  <button
                    type="button"
                    className={
                      "do-crumb" + (c.id === focus.id ? " current" : "")
                    }
                    onClick={() => enter(c.id)}
                  >
                    {c.displayTitle || c.title}
                  </button>
                </span>
              ))}
            </nav>
            <div className="do-toolbar-actions">
              {focus.level > 0 ? (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    const parent = crumbs[crumbs.length - 2];
                    if (parent) enter(parent.id);
                  }}
                >
                  ← 上级 Esc
                </button>
              ) : null}
              <button
                type="button"
                className="linkish"
                onClick={() => jump(focus.lineStart)}
              >
                编辑定位
              </button>
            </div>
          </div>

          <div className="do-focus-head">
            <div className="do-focus-row">
              <span className={`do-focus-badge role-${focus.role}`}>
                {focus.level === 0
                  ? "DOCUMENT"
                  : ROLE_LABEL[focus.role]}
              </span>
              <MetaBadges s={focus} />
            </div>
            <h2 className="do-focus-title">
              {focus.reqId ? (
                <span className="do-req-inline">{focus.reqId} </span>
              ) : null}
              {focus.displayTitle}
            </h2>
            <div className="do-focus-meta-row">
              <span className="do-focus-meta">
                L{focus.lineStart + 1}
                {focus.stats.childCount
                  ? ` · ${focus.stats.childCount} 子标题`
                  : ""}
                {focus.stats.tasksOpen + focus.stats.tasksDone > 0
                  ? ` · 任务 ${focus.stats.tasksDone}/${focus.stats.tasksOpen + focus.stats.tasksDone}`
                  : ""}
              </span>
              <ProgressBar value={focus.stats.progress} />
            </div>
          </div>

          <div className="do-scroll">
            {/* 搜索结果快捷列表 */}
            {searchHits && filter.q.trim() && focus.level === 0 ? (
              <section className="do-section-block">
                <h3 className="do-block-title">
                  搜索结果 · {searchHits.length}
                </h3>
                <div className="do-hit-list">
                  {searchHits.slice(0, 40).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="do-hit-row"
                      onClick={() => enter(s.id)}
                    >
                      <span className={`do-role-pill role-${s.role}`}>
                        {ROLE_LABEL[s.role]}
                      </span>
                      <span className="do-hit-title">
                        {s.reqId ? `${s.reqId} ` : ""}
                        {s.displayTitle}
                      </span>
                      <ProgressBar value={s.stats.progress} thin />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {/* 根：功能总览 */}
            {focus.level === 0 && overviewCards.length > 0 ? (
              <section className="do-section-block">
                <h3 className="do-block-title">需求总览 · 点击进入</h3>
                <div className="do-child-grid">
                  {overviewCards.map((c) => (
                    <ChildCard
                      key={c.id}
                      s={c}
                      onEnter={() => enter(c.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {focus.level > 0 && filteredChildren.length > 0 ? (
              <section className="do-section-block">
                <h3 className="do-block-title">子章节</h3>
                <div className="do-child-grid">
                  {filteredChildren.map((c) => (
                    <ChildCard
                      key={c.id}
                      s={c}
                      onEnter={() => enter(c.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="do-section-block">
              <h3 className="do-block-title">
                {focus.level === 0 ? "文档前言 / 说明" : "本章说明与验收结构"}
              </h3>
              <BodyTree nodes={bodyNodes} onJump={jump} />
            </section>
          </div>
        </div>

        <aside className="do-rail">
          <div className="do-rail-head">
            结构导航
            <span className="do-rail-count">{st.sectionCount}</span>
          </div>
          <div className="do-rail-tree">
            <SectionTree
              section={parsed.root}
              activeId={focus.id}
              depth={0}
              filter={filter}
              onSelect={enter}
              forceOpen={!!filter.q.trim()}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
