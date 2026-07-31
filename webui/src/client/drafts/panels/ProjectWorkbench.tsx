/**
 * Draft project mode — 文档树 | 源码/预览/节点画布 | 大纲
 * Fixtures only. Canvas ops align with Project Graph core tree mechanics.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DraftMarkdown } from "../DraftMarkdown";
import {
  DEFAULT_PROJECT_DOC_PATH,
  PROJECT_DOCS,
  buildProjectTree,
  appendHeading,
  escapeCssAttrSelector,
  filterDocsForQuickOpen,
  filterOutlineItems,
  filterProjectTree,
  findHeadingLineByTitle,
  findNextLineContaining,
  findPrevLineContaining,
  getProjectDoc,
  isMarkdownDirty,
  isPathUnderFolder,
  markdownDocStats,
  parseProjectOutline,
  parseProjectViewMode,
  projectDocKindLabel,
  setTaskChecked,
  syncHeadingRename,
  type ProjectDoc,
  type ProjectTreeNode,
  type ProjectViewMode,
} from "../project-docs";
import {
  findNodeIdByText,
  getNode,
  graphFingerprint,
  graphFromOutline,
  graphToMarkdownOutline,
  selectNode,
  type ProjectGraphState,
} from "../project-graph";
import {
  clearProjectSession,
  closeRecentPath,
  cycleRecentPath,
  listDirtyDocPaths,
  mergeDraftsWithFixtures,
  outlineGraphDrift,
  pushRecentPath,
  readProjectSession,
  sanitizeRecentPaths,
  writeProjectSession,
} from "../project-session";
import { ChromeMark } from "../icons/Marks";
import { SourceEditor } from "../../markdown/editor/SourceEditor";
import { ProjectCanvas } from "./ProjectCanvas";

export type ProjectWorkbenchProps = {
  projectLabel: string;
  projectPath: string;
  docs?: ProjectDoc[];
};

const VIEW_STORAGE_KEY = "maou-draft-project-view";
const SPLIT_STORAGE_KEY = "maou-draft-project-split-pct";

function readStoredView(): ProjectViewMode {
  if (typeof sessionStorage === "undefined") return "split";
  try {
    return parseProjectViewMode(sessionStorage.getItem(VIEW_STORAGE_KEY)) ?? "split";
  } catch {
    return "split";
  }
}

function readStoredSplitPct(): number {
  if (typeof sessionStorage === "undefined") return 50;
  try {
    const n = Number(sessionStorage.getItem(SPLIT_STORAGE_KEY));
    if (Number.isFinite(n) && n >= 25 && n <= 75) return n;
  } catch {
    /* ignore */
  }
  return 50;
}

export function ProjectWorkbench({
  projectLabel,
  projectPath,
  docs = PROJECT_DOCS,
}: ProjectWorkbenchProps) {
  const restored = useMemo(
    () => readProjectSession(projectPath),
    [projectPath],
  );
  const [activePath, setActivePath] = useState(
    () =>
      (restored?.activePath &&
      docs.some((d) => d.path === restored.activePath)
        ? restored.activePath
        : DEFAULT_PROJECT_DOC_PATH),
  );
  const [view, setView] = useState<ProjectViewMode>(() => readStoredView());
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    mergeDraftsWithFixtures(docs, restored?.drafts),
  );
  const [graphs, setGraphs] = useState<Record<string, ProjectGraphState>>(
    () => restored?.graphs ?? {},
  );
  const [graphBaselines, setGraphBaselines] = useState<
    Record<string, string>
  >(() => restored?.graphBaselines ?? {});
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [pendingJumpLine, setPendingJumpLine] = useState<number | null>(null);
  const [canvasFocusNodeId, setCanvasFocusNodeId] = useState<string | null>(
    null,
  );
  /** Session baselines (accept / 同步) — defaults to fixture content. */
  const [contentBaselines, setContentBaselines] = useState<
    Record<string, string>
  >(() => restored?.contentBaselines ?? {});
  const [docFilter, setDocFilter] = useState("");
  const [outlineFilter, setOutlineFilter] = useState("");
  /** Source pane width % in split mode. */
  const [splitPct, setSplitPct] = useState(() => readStoredSplitPct());
  /** Bumps ProjectCanvas remount (history reset) on rebuild/reset. */
  const [graphEpoch, setGraphEpoch] = useState(0);
  const [hideTree, setHideTree] = useState(() => Boolean(restored?.hideTree));
  const [hideOutline, setHideOutline] = useState(() =>
    Boolean(restored?.hideOutline),
  );
  const [copyFlash, setCopyFlash] = useState(false);
  const [dismissDrift, setDismissDrift] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>(() =>
    sanitizeRecentPaths(
      restored?.recentPaths ??
        (restored?.activePath ? [restored.activePath] : undefined),
      docs.map((d) => d.path),
      DEFAULT_PROJECT_DOC_PATH,
    ),
  );
  const [docSearch, setDocSearch] = useState("");
  const [docSearchHit, setDocSearchHit] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [quickIndex, setQuickIndex] = useState(0);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashStatus = (msg: string) => {
    setStatusToast(msg);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => {
      setStatusToast((t) => (t === msg ? null : t));
    }, 1600);
  };
  const splitDragRef = useRef<{ startX: number; startPct: number } | null>(
    null,
  );
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const outlineListRef = useRef<HTMLDivElement>(null);
  const docSearchRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => buildProjectTree(docs), [docs]);
  const filteredTree = useMemo(
    () => filterProjectTree(tree, docFilter),
    [tree, docFilter],
  );
  const activeDoc = getProjectDoc(activePath, docs);
  const content = drafts[activePath] ?? activeDoc?.content ?? "";
  const fixtureBaseline = activeDoc?.content ?? "";
  const baseline = contentBaselines[activePath] ?? fixtureBaseline;
  const dirtyMd = isMarkdownDirty(content, baseline);
  const outline = useMemo(() => parseProjectOutline(content), [content]);
  const mdStats = useMemo(() => markdownDocStats(content), [content]);

  /** Paths with MD and/or canvas edits (for tree dirty dots). */
  const dirtyPathList = useMemo(
    () =>
      listDirtyDocPaths(
        docs,
        drafts,
        contentBaselines,
        graphs,
        graphBaselines,
        graphFingerprint,
      ),
    [docs, drafts, contentBaselines, graphs, graphBaselines],
  );
  const dirtyPaths = useMemo(() => new Set(dirtyPathList), [dirtyPathList]);

  useEffect(() => {
    setRecentPaths((prev) => pushRecentPath(prev, activePath));
  }, [activePath]);

  // Keep active recent tab visible when many tabs overflow
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(
      `.wire-project-tab.active`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePath, recentPaths.length]);

  // Scroll document tree to active file (after ancestor folders expand)
  useEffect(() => {
    if (typeof document === "undefined" || hideTree) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-project-path="${escapeCssAttrSelector(activePath)}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [activePath, docFilter, hideTree]);

  const quickHits = useMemo(
    () => filterDocsForQuickOpen(docs, quickQuery),
    [docs, quickQuery],
  );

  useEffect(() => {
    setQuickIndex(0);
  }, [quickQuery, quickOpen]);

  useEffect(() => {
    if (!quickOpen) return;
    requestAnimationFrame(() => {
      quickInputRef.current?.focus();
      quickInputRef.current?.select();
    });
  }, [quickOpen]);

  // Warn before closing browser tab when session has dirty docs
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (dirtyPathList.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyPathList.length]);

  const ensureGraph = (path: string, md: string): ProjectGraphState => {
    if (graphs[path]) return graphs[path]!;
    const items = parseProjectOutline(md).map((h) => ({
      level: h.level,
      title: h.title,
    }));
    const seeded = graphFromOutline(items);
    // defer state write for first paint consumers via side effect below
    return seeded;
  };

  // Seed graph for active path once
  useEffect(() => {
    setGraphs((prev) => {
      if (prev[activePath]) return prev;
      const items = parseProjectOutline(content).map((h) => ({
        level: h.level,
        title: h.title,
      }));
      const seeded = graphFromOutline(items);
      setGraphBaselines((b) => ({
        ...b,
        [activePath]: graphFingerprint(seeded),
      }));
      return { ...prev, [activePath]: seeded };
    });
    // only re-seed when path changes without existing graph
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  const graph =
    graphs[activePath] ??
    ensureGraph(activePath, content);
  const dirtyGraph =
    graphBaselines[activePath] != null &&
    graphFingerprint(graph) !== graphBaselines[activePath];
  const dirty = dirtyMd || dirtyGraph;

  const hasOutlineDrift = useMemo(() => {
    if (dismissDrift) return false;
    return outlineGraphDrift(
      outline.map((h) => ({ level: h.level, title: h.title })),
      graphs[activePath] ?? graph,
    );
  }, [outline, graphs, activePath, graph, dismissDrift]);

  // Persist session so refresh keeps edits (debounced to avoid thrash)
  useEffect(() => {
    if (typeof window === "undefined") {
      writeProjectSession(projectPath, {
        v: 1,
        activePath,
        recentPaths,
        drafts,
        contentBaselines,
        graphs,
        graphBaselines,
        hideTree,
        hideOutline,
      });
      return;
    }
    const t = window.setTimeout(() => {
      writeProjectSession(projectPath, {
        v: 1,
        activePath,
        recentPaths,
        drafts,
        contentBaselines,
        graphs,
        graphBaselines,
        hideTree,
        hideOutline,
      });
    }, 280);
    return () => window.clearTimeout(t);
  }, [
    projectPath,
    activePath,
    recentPaths,
    drafts,
    contentBaselines,
    graphs,
    graphBaselines,
    hideTree,
    hideOutline,
  ]);

  useEffect(() => {
    setDismissDrift(false);
  }, [activePath, content]);

  const onChange = (next: string) => {
    setDrafts((prev) => ({ ...prev, [activePath]: next }));
  };

  const onReset = () => {
    if (dirty) {
      const ok =
        typeof window !== "undefined"
          ? window.confirm("丢弃当前文档与画布的未保存改动，恢复 fixtures？")
          : true;
      if (!ok) return;
    }
    if (activeDoc) {
      setDrafts((prev) => ({ ...prev, [activePath]: activeDoc.content }));
    }
    setContentBaselines((prev) => {
      const next = { ...prev };
      delete next[activePath];
      return next;
    });
    const items = parseProjectOutline(activeDoc?.content ?? "").map((h) => ({
      level: h.level,
      title: h.title,
    }));
    const seeded = graphFromOutline(items);
    setGraphs((prev) => ({ ...prev, [activePath]: seeded }));
    setGraphBaselines((b) => ({
      ...b,
      [activePath]: graphFingerprint(seeded),
    }));
    setGraphEpoch((e) => e + 1);
    flashStatus("已重置当前文档");
  };

  /** Draft "save": accept current MD + graph as clean baseline (no disk I/O). */
  const onAcceptBaseline = () => {
    setContentBaselines((prev) => ({ ...prev, [activePath]: content }));
    setGraphBaselines((b) => ({
      ...b,
      [activePath]: graphFingerprint(graph),
    }));
    flashStatus("已同步当前文档");
  };

  /** Accept baselines for every dirty path (session "save all"). */
  const onAcceptAllBaselines = () => {
    if (dirtyPathList.length === 0) return;
    const n = dirtyPathList.length;
    setContentBaselines((prev) => {
      const next = { ...prev };
      for (const path of dirtyPathList) {
        const doc = getProjectDoc(path, docs);
        next[path] = drafts[path] ?? doc?.content ?? "";
      }
      return next;
    });
    setGraphBaselines((prev) => {
      const next = { ...prev };
      for (const path of dirtyPathList) {
        const g = graphs[path];
        if (g) next[path] = graphFingerprint(g);
      }
      // ensure active graph covered even if just seeded in-memory
      if (dirtyPathList.includes(activePath)) {
        next[activePath] = graphFingerprint(graph);
      }
      return next;
    });
    flashStatus(`已同步 ${n} 个文档`);
  };

  const onGraphChange = (next: ProjectGraphState) => {
    setGraphs((prev) => ({ ...prev, [activePath]: next }));
  };

  const rebuildGraphFromOutline = () => {
    const items = outline.map((h) => ({ level: h.level, title: h.title }));
    const seeded = graphFromOutline(items);
    setGraphs((prev) => ({ ...prev, [activePath]: seeded }));
    setGraphEpoch((e) => e + 1);
    setDismissDrift(true);
    flashStatus("已从大纲重建画布");
  };

  const writeOutlineFromGraph = () => {
    const md = graphToMarkdownOutline(graph);
    if (!md.trim()) return;
    const ok =
      typeof window !== "undefined"
        ? window.confirm(
            "用当前节点图的标题树覆盖本文 Markdown？正文段落会丢失（仅大纲标题）。",
          )
        : true;
    if (!ok) return;
    onChange(md + "\n");
    setView("split");
    flashStatus("已写入大纲到 Markdown");
  };

  const locateSourceFromTitle = (title: string) => {
    const line = findHeadingLineByTitle(content, title);
    setView("split");
    if (line != null) {
      setFocusLine(line);
      setPendingJumpLine(line);
      requestAnimationFrame(() => {
        const prev = previewRef.current;
        if (!prev) return;
        const heads = prev.querySelectorAll("h1,h2,h3,h4,h5,h6");
        for (const el of heads) {
          if ((el.textContent ?? "").trim() === title) {
            el.scrollIntoView({ block: "start", behavior: "smooth" });
            break;
          }
        }
      });
      return;
    }
    // No matching heading — still open split so user can edit MD
    setFocusLine(null);
    setPendingJumpLine(null);
  };

  /**
   * Jump to heading line. preferCanvas (Alt/double-click): switch to canvas
   * and focus the matching node when present.
   */
  const jumpToLine = (line: number, preferCanvas = false) => {
    setFocusLine(line);
    const title = outline.find((h) => h.line === line)?.title;

    if (preferCanvas && title) {
      const id = findNodeIdByText(graph, title);
      if (id) {
        setView("canvas");
        onGraphChange(selectNode(graph, id));
        setCanvasFocusNodeId(id);
        return;
      }
    }

    // Canvas mode: select matching node by title (outline ↔ graph).
    if (view === "canvas" && title) {
      const id = findNodeIdByText(graph, title);
      if (id) {
        onGraphChange(selectNode(graph, id));
        setCanvasFocusNodeId(id);
        return;
      }
    }

    setPendingJumpLine(line);
    if (view === "canvas") setView("split");
    // Preview: scroll first heading match into view when possible.
    const prev = previewRef.current;
    if (prev && (view === "preview" || view === "split" || !preferCanvas) && title) {
      requestAnimationFrame(() => {
        const heads = prev.querySelectorAll("h1,h2,h3,h4,h5,h6");
        for (const el of heads) {
          if ((el.textContent ?? "").trim() === title) {
            el.scrollIntoView({ block: "start", behavior: "smooth" });
            break;
          }
        }
      });
    }
  };

  useEffect(() => {
    setFocusLine(null);
    setPendingJumpLine(null);
    setOutlineFilter("");
    setDocSearch("");
    setDocSearchHit(null);
  }, [activePath]);

  // Persist view + split ratio for the session
  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(splitPct)));
    } catch {
      /* ignore */
    }
  }, [splitPct]);

  // ⌘/Ctrl+S 同步；⌘F 查找；⌥1–4 视图
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (e.shiftKey) {
          if (dirtyPathList.length > 0) onAcceptAllBaselines();
        } else if (dirty) {
          onAcceptBaseline();
        }
        return;
      }
      // Always intercept ⌘F so project in-doc search wins over browser find
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        if (view === "canvas") setView("split");
        requestAnimationFrame(() => {
          docSearchRef.current?.focus();
          docSearchRef.current?.select();
        });
        return;
      }
      // ⌘W closes current recent tab
      if ((e.metaKey || e.ctrlKey) && (e.key === "w" || e.key === "W")) {
        if (quickOpen) {
          e.preventDefault();
          setQuickOpen(false);
          return;
        }
        e.preventDefault();
        if (recentPaths.length > 1) closeTab(activePath);
        return;
      }
      // ⌘P quick-open document
      if ((e.metaKey || e.ctrlKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setQuickQuery("");
        setQuickOpen(true);
        return;
      }
      if (e.key === "Escape" && quickOpen) {
        e.preventDefault();
        setQuickOpen(false);
        return;
      }
      if (e.key === "Escape" && (docSearch || docSearchHit)) {
        // Clear in-doc find chrome without stealing canvas Esc
        const t = e.target as HTMLElement | null;
        if (t === docSearchRef.current || t?.closest?.(".wire-project-doc-search")) {
          e.preventDefault();
          setDocSearch("");
          setDocSearchHit(null);
          docSearchRef.current?.blur();
          return;
        }
      }
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          t.closest?.(".cm-editor"))
      ) {
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const map: Record<string, ProjectViewMode> = {
          "1": "split",
          "2": "preview",
          "3": "source",
          "4": "canvas",
        };
        const mode = map[e.key];
        if (mode) {
          e.preventDefault();
          setView(mode);
          return;
        }
        // ⌥[ / ⌥] cycle recent tabs
        if (e.key === "[" || e.key === "]") {
          e.preventDefault();
          const next = cycleRecentPath(
            recentPaths,
            activePath,
            e.key === "]" ? 1 : -1,
          );
          if (next) openPath(next);
          return;
        }
      }
      // Ctrl/Cmd+Tab cycle recent (Shift reverse)
      if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
        e.preventDefault();
        const next = cycleRecentPath(
          recentPaths,
          activePath,
          e.shiftKey ? -1 : 1,
        );
        if (next) openPath(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Flash preview heading when focusLine changes; else scroll by line ratio
  useEffect(() => {
    const prev = previewRef.current;
    if (!prev || focusLine == null) return;
    prev
      .querySelectorAll(".wire-md-heading-focus")
      .forEach((el) => el.classList.remove("wire-md-heading-focus"));
    const title = outline.find((h) => h.line === focusLine)?.title;
    if (title) {
      const heads = prev.querySelectorAll("h1,h2,h3,h4,h5,h6");
      for (const el of heads) {
        if ((el.textContent ?? "").trim() === title) {
          el.classList.add("wire-md-heading-focus");
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          return;
        }
      }
    }
    // Non-heading jump (e.g. text find): approximate scroll by line ratio
    const total = Math.max(1, content.split("\n").length);
    const ratio = Math.min(1, Math.max(0, focusLine / total));
    const maxScroll = Math.max(0, prev.scrollHeight - prev.clientHeight);
    prev.scrollTo({ top: ratio * maxScroll, behavior: "smooth" });
  }, [focusLine, content, view, outline]);

  const onNodeRename = (oldTitle: string, newTitle: string) => {
    const next = syncHeadingRename(content, oldTitle, newTitle);
    if (next !== content) onChange(next);
  };

  const copyActivePath = async () => {
    try {
      await navigator.clipboard?.writeText(activePath);
      setCopyFlash(true);
      window.setTimeout(() => setCopyFlash(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const openPath = (path: string, opts?: { revealTree?: boolean }) => {
    if (!docs.some((d) => d.path === path)) return;
    setActivePath(path);
    setQuickOpen(false);
    setQuickQuery("");
    if (opts?.revealTree) setHideTree(false);
  };

  const confirmQuickOpen = (index = quickIndex) => {
    const hit = quickHits[index] ?? quickHits[0];
    if (!hit) return;
    openPath(hit.path, { revealTree: true });
  };

  const closeTab = (path: string) => {
    const result = closeRecentPath(recentPaths, path, activePath);
    setRecentPaths(
      result.recent.length > 0
        ? result.recent
        : [result.active || DEFAULT_PROJECT_DOC_PATH],
    );
    if (result.active && result.active !== activePath) {
      openPath(result.active);
    } else if (result.recent.length === 0) {
      openPath(DEFAULT_PROJECT_DOC_PATH);
      setRecentPaths([DEFAULT_PROJECT_DOC_PATH]);
    }
  };

  const jumpNextDirty = () => {
    if (dirtyPathList.length === 0) return;
    const idx = dirtyPathList.indexOf(activePath);
    const next =
      dirtyPathList[(idx + 1) % dirtyPathList.length] ?? dirtyPathList[0]!;
    openPath(next, { revealTree: true });
  };

  const runDocSearch = (
    q: string = docSearch,
    direction: "next" | "prev" = "next",
  ) => {
    const hit =
      direction === "prev"
        ? findPrevLineContaining(content, q, focusLine)
        : findNextLineContaining(content, q, focusLine);
    if (!hit) {
      setDocSearchHit(q.trim() ? "无匹配" : null);
      return;
    }
    if (view === "canvas") setView("split");
    setFocusLine(hit.line);
    setPendingJumpLine(hit.line);
    setDocSearchHit(`${hit.index + 1}/${hit.total}`);
  };

  const addHeading = () => {
    const next = appendHeading(content, "新标题", 2);
    onChange(next);
    if (view === "canvas") setView("split");
    const line = findHeadingLineByTitle(next, "新标题");
    if (line != null) {
      setFocusLine(line);
      setPendingJumpLine(line);
    }
    flashStatus("已添加 ## 新标题");
  };

  const clearSessionDrafts = () => {
    const ok =
      typeof window !== "undefined"
        ? window.confirm(
            "清除本项目会话草稿（MD/画布/基线），恢复全部 fixtures？",
          )
        : true;
    if (!ok) return;
    clearProjectSession(projectPath);
    setDrafts(mergeDraftsWithFixtures(docs, undefined));
    setContentBaselines({});
    setGraphs({});
    setGraphBaselines({});
    setGraphEpoch((e) => e + 1);
    setDismissDrift(false);
    setRecentPaths([DEFAULT_PROJECT_DOC_PATH]);
    setActivePath(DEFAULT_PROJECT_DOC_PATH);
    flashStatus("已清除会话草稿");
  };

  const onSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    splitDragRef.current = { startX: e.clientX, startPct: splitPct };
  };

  const onSplitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current;
    const host = canvasHostRef.current;
    if (!drag || !host) return;
    const w = host.clientWidth || 1;
    const dx = e.clientX - drag.startX;
    const next = Math.min(75, Math.max(25, drag.startPct + (dx / w) * 100));
    setSplitPct(next);
  };

  const onSplitPointerUp = () => {
    splitDragRef.current = null;
  };

  const showSource = view === "source" || view === "split";
  const showPreview = view === "preview" || view === "split";
  const showCanvas = view === "canvas";
  const filteredOutline = useMemo(
    () => filterOutlineItems(outline, outlineFilter),
    [outline, outlineFilter],
  );

  const selectedNodeTitle = graph.selectedId
    ? (getNode(graph, graph.selectedId)?.text ?? null)
    : null;

  // Keep active outline item in view
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(
      ".wire-project-outline-item.active",
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusLine, selectedNodeTitle, outlineFilter, hideOutline]);

  return (
    <section
      ref={shellRef}
      className="wire-project"
      aria-label="项目工作台"
    >
      <header className="wire-project-bar">
        <div className="wire-project-bar-left">
          <ChromeMark kind="mode_project" size={14} decorative />
          <span className="wire-project-title">{projectLabel}</span>
          <span className="wire-project-path" title={projectPath}>
            {projectPath}
          </span>
          <div className="wire-project-rail-toggles" role="group" aria-label="侧栏">
            <button
              type="button"
              title="快速打开文档 ⌘P"
              onClick={() => {
                setQuickQuery("");
                setQuickOpen(true);
              }}
            >
              打开
            </button>
            <button
              type="button"
              className={hideTree ? "is-off" : ""}
              aria-pressed={!hideTree}
              title="显示/隐藏文档树"
              onClick={() => setHideTree((v) => !v)}
            >
              文档
            </button>
            <button
              type="button"
              className={hideOutline ? "is-off" : ""}
              aria-pressed={!hideOutline}
              title="显示/隐藏大纲"
              onClick={() => setHideOutline((v) => !v)}
            >
              大纲
            </button>
          </div>
        </div>
        <div
          className="wire-project-bar-center"
          role="tablist"
          aria-label="视图 ⌥1–4"
        >
          {(
            [
              ["split", "分栏"],
              ["preview", "预览"],
              ["source", "源码"],
              ["canvas", "画布"],
            ] as const
          ).map(([id, lab]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
              title={`${lab} (⌥${id === "split" ? "1" : id === "preview" ? "2" : id === "source" ? "3" : "4"})`}
            >
              {lab}
            </button>
          ))}
        </div>
        <div className="wire-project-bar-right">
          {dirtyPathList.length > 0 ? (
            <button
              type="button"
              className="wire-project-dirty-count"
              onClick={jumpNextDirty}
              title="跳到下一个有改动的文档"
            >
              {dirtyPathList.length} 改动
            </button>
          ) : null}
          {dirty ? (
            <span className="wire-project-dirty-group" aria-label="未保存改动">
              {dirtyMd ? (
                <span className="wire-project-dirty" title="Markdown 相对基线有改动">
                  MD
                </span>
              ) : null}
              {dirtyGraph ? (
                <span className="wire-project-dirty is-graph" title="画布相对基线有改动">
                  画布
                </span>
              ) : null}
            </span>
          ) : (
            <span className="wire-project-clean">已同步</span>
          )}
          <button
            type="button"
            className="wire-project-action"
            disabled={!dirty}
            onClick={onAcceptBaseline}
            title="将当前 MD 与画布接受为会话基线 ⌘S（草稿站不写盘）"
          >
            同步
          </button>
          {dirtyPathList.length > 1 ? (
            <button
              type="button"
              className="wire-project-action"
              onClick={onAcceptAllBaselines}
              title="将全部有改动文档接受为会话基线 ⌘⇧S"
            >
              全同步
            </button>
          ) : null}
          <button
            type="button"
            className="wire-project-action"
            disabled={!dirty && content === fixtureBaseline}
            onClick={onReset}
            title="恢复 fixtures 内容并重建画布"
          >
            重置
          </button>
          <button
            type="button"
            className="wire-project-action"
            onClick={clearSessionDrafts}
            title="清除 sessionStorage 中本项目全部草稿"
          >
            清会话
          </button>
        </div>
      </header>

      {recentPaths.length > 0 ? (
        <div className="wire-project-tabs" role="tablist" aria-label="最近文档 ⌥[/]">
          {recentPaths.map((p) => {
            const name = p.split("/").pop() ?? p;
            const isActive = p === activePath;
            const isDirty = dirtyPaths.has(p);
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`wire-project-tab${isActive ? " active" : ""}${
                  isDirty ? " is-dirty" : ""
                }`}
                title={p}
                onClick={() => openPath(p)}
              >
                <span className="wire-project-tab-name">{name}</span>
                {isDirty ? (
                  <span className="wire-project-tree-dirty" aria-label="已修改" />
                ) : null}
                {recentPaths.length > 1 ? (
                  <span
                    className="wire-project-tab-close"
                    role="button"
                    tabIndex={0}
                    title="关闭页签"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(p);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        closeTab(p);
                      }
                    }}
                  >
                    ×
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className={`wire-project-body${hideTree ? " is-hide-tree" : ""}${
          hideOutline ? " is-hide-outline" : ""
        }`}
      >
        <aside className="wire-project-tree" aria-label="项目文档树">
          <div className="wire-project-pane-head">
            文档
            <span className="wire-project-pane-count" title="文档数量">
              {docs.length}
              {dirtyPathList.length > 0 ? ` · ${dirtyPathList.length}改` : ""}
            </span>
          </div>
          <div className="wire-project-tree-filter">
            <input
              type="search"
              className="wire-project-tree-search"
              placeholder="筛选文档…"
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              aria-label="筛选文档"
            />
          </div>
          <div className="wire-project-tree-scroll">
            {filteredTree.length === 0 ? (
              <div className="wire-project-empty">无匹配文档</div>
            ) : (
              filteredTree.map((n) => (
                <TreeNode
                  key={n.path}
                  node={n}
                  depth={0}
                  activePath={activePath}
                  dirtyPaths={dirtyPaths}
                  forceOpen={docFilter.trim().length > 0}
                  onOpen={openPath}
                />
              ))
            )}
          </div>
        </aside>

        <div className="wire-project-editor" aria-label="编辑与预览">
          <div className="wire-project-pane-head wire-project-file-head">
            <button
              type="button"
              className="wire-project-file-path wire-project-path-copy"
              onClick={copyActivePath}
              title="点击复制路径"
            >
              {copyFlash ? "已复制路径" : activePath}
            </button>
            <form
              className="wire-project-doc-search"
              onSubmit={(e) => {
                e.preventDefault();
                runDocSearch(docSearch, "next");
              }}
            >
              <input
                ref={docSearchRef}
                type="search"
                className="wire-project-tree-search"
                placeholder="查找 ⌘F · ↵下 · ⇧↵上"
                value={docSearch}
                onChange={(e) => {
                  setDocSearch(e.target.value);
                  setDocSearchHit(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    runDocSearch(docSearch, "prev");
                  }
                }}
                aria-label="在当前文档查找，回车下一个，Shift+回车上一个"
              />
              {docSearchHit ? (
                <span className="wire-project-doc-search-hit" aria-live="polite">
                  {docSearchHit}
                </span>
              ) : null}
            </form>
            <span className="wire-project-file-meta">
              {mdStats.lines} 行 · {mdStats.chars} 字
              {outline.length > 0 ? ` · ${outline.length} 标题` : ""}
              {focusLine != null ? ` · L${focusLine + 1}` : ""}
            </span>
            {activeDoc ? (
              <span className="wire-project-kind">
                {projectDocKindLabel(activeDoc.kind)}
              </span>
            ) : null}
          </div>
          {hasOutlineDrift ? (
            <div className="wire-project-drift" role="status">
              <span>
                {view === "canvas"
                  ? "大纲与画布结构不一致"
                  : "Markdown 大纲与画布不一致（可重建画布）"}
              </span>
              <button
                type="button"
                className="wire-project-action"
                onClick={() => {
                  rebuildGraphFromOutline();
                  if (view !== "canvas") setView("canvas");
                }}
              >
                从大纲重建
              </button>
              <button
                type="button"
                className="wire-project-action"
                onClick={() => setDismissDrift(true)}
              >
                忽略
              </button>
            </div>
          ) : null}
          <div
            ref={canvasHostRef}
            className={`wire-project-canvas is-${view}`}
            data-view={view}
            style={
              view === "split"
                ? {
                    gridTemplateColumns: `minmax(0, ${splitPct}fr) 5px minmax(0, ${
                      100 - splitPct
                    }fr)`,
                  }
                : undefined
            }
          >
            {showCanvas ? (
              <ProjectCanvas
                key={`${activePath}::${graphEpoch}`}
                graph={graph}
                onChange={onGraphChange}
                onRebuildFromOutline={rebuildGraphFromOutline}
                onWriteOutlineToMd={writeOutlineFromGraph}
                onLocateSource={locateSourceFromTitle}
                onNodeRename={onNodeRename}
                focusNodeId={canvasFocusNodeId}
                onFocusNodeHandled={() => setCanvasFocusNodeId(null)}
              />
            ) : (
              <>
                {showSource && (
                  <div className="wire-project-source-wrap">
                    <SourceEditor
                      value={content}
                      onChange={onChange}
                      pendingJumpLine={pendingJumpLine}
                      onJumpHandled={() => setPendingJumpLine(null)}
                    />
                  </div>
                )}
                {view === "split" ? (
                  <div
                    className="wire-project-split-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="拖动调整源码 / 预览宽度"
                    aria-valuenow={Math.round(splitPct)}
                    aria-valuemin={25}
                    aria-valuemax={75}
                    tabIndex={0}
                    onPointerDown={onSplitPointerDown}
                    onPointerMove={onSplitPointerMove}
                    onPointerUp={onSplitPointerUp}
                    onPointerCancel={onSplitPointerUp}
                    onKeyDown={(e) => {
                      const step = e.shiftKey ? 5 : 2;
                      if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        setSplitPct((p) => Math.max(25, p - step));
                      } else if (e.key === "ArrowRight") {
                        e.preventDefault();
                        setSplitPct((p) => Math.min(75, p + step));
                      }
                    }}
                  />
                ) : null}
                {showPreview && (
                  <div
                    ref={previewRef}
                    className="wire-project-preview"
                    data-focus-line={focusLine ?? undefined}
                  >
                    <DraftMarkdown
                      source={content}
                      onHeadingClick={(title) => {
                        const line = findHeadingLineByTitle(content, title);
                        if (line == null) return;
                        setFocusLine(line);
                        setPendingJumpLine(line);
                        // Ensure source pane is visible for landing
                        if (view === "preview") setView("split");
                      }}
                      onTaskToggle={(taskText, checked) => {
                        const next = setTaskChecked(content, taskText, checked);
                        if (next !== content) onChange(next);
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <aside className="wire-project-outline" aria-label="大纲">
          <div className="wire-project-pane-head">
            大纲
            <span className="wire-project-pane-count" title="标题数量">
              {outline.length}
            </span>
            <button
              type="button"
              className="wire-project-action wire-project-outline-add"
              onClick={addHeading}
              title="在文末添加 ## 新标题"
            >
              + 标题
            </button>
          </div>
          <div className="wire-project-tree-filter">
            <input
              type="search"
              className="wire-project-tree-search"
              placeholder="筛选标题…"
              value={outlineFilter}
              onChange={(e) => setOutlineFilter(e.target.value)}
              aria-label="筛选大纲标题"
            />
          </div>
          <div
            ref={outlineListRef}
            className="wire-project-outline-scroll"
            tabIndex={0}
            role="listbox"
            aria-label="大纲列表，方向键选择"
            onKeyDown={(e) => {
              if (filteredOutline.length === 0) return;
              const idx = filteredOutline.findIndex(
                (h) =>
                  h.line === focusLine ||
                  (selectedNodeTitle != null && h.title === selectedNodeTitle),
              );
              const cur = idx < 0 ? 0 : idx;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = filteredOutline[Math.min(filteredOutline.length - 1, cur + 1)]!;
                jumpToLine(next.line, e.altKey);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                const next = filteredOutline[Math.max(0, cur - 1)]!;
                jumpToLine(next.line, e.altKey);
              } else if (e.key === "Enter" && filteredOutline[cur]) {
                e.preventDefault();
                // Alt+Enter / ⌘+Enter → open on canvas
                jumpToLine(
                  filteredOutline[cur]!.line,
                  e.altKey || e.metaKey || e.ctrlKey,
                );
              } else if (e.key === "Home") {
                e.preventDefault();
                jumpToLine(filteredOutline[0]!.line);
              } else if (e.key === "End") {
                e.preventDefault();
                jumpToLine(filteredOutline[filteredOutline.length - 1]!.line);
              }
            }}
          >
            {outline.length === 0 ? (
              <div className="wire-project-empty">无标题</div>
            ) : filteredOutline.length === 0 ? (
              <div className="wire-project-empty">无匹配标题</div>
            ) : (
              filteredOutline.map((h) => {
                const active =
                  focusLine === h.line ||
                  (selectedNodeTitle != null && selectedNodeTitle === h.title);
                return (
                  <button
                    key={h.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`wire-project-outline-item level-${h.level}${
                      active ? " active" : ""
                    }`}
                    style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                    onClick={(e) => jumpToLine(h.line, e.altKey)}
                    onDoubleClick={() => jumpToLine(h.line, true)}
                    title={`L${h.line + 1} · Alt/双击 → 画布节点`}
                  >
                    {h.title}
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {statusToast ? (
        <div className="wire-project-status-toast" role="status" aria-live="polite">
          {statusToast}
        </div>
      ) : null}

      {quickOpen ? (
        <div
          className="wire-project-quickopen"
          role="dialog"
          aria-modal="true"
          aria-label="快速打开文档"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setQuickOpen(false);
          }}
        >
          <div className="wire-project-quickopen-panel">
            <input
              ref={quickInputRef}
              type="search"
              className="wire-project-quickopen-input"
              placeholder="打开文档… 路径 / 文件名"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setQuickOpen(false);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setQuickIndex((i) =>
                    Math.min(quickHits.length - 1, Math.max(0, i + 1)),
                  );
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setQuickIndex((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmQuickOpen();
                }
              }}
              aria-label="快速打开搜索"
            />
            <div className="wire-project-quickopen-list" role="listbox">
              {quickHits.length === 0 ? (
                <div className="wire-project-empty">无匹配文档</div>
              ) : (
                quickHits.map((h, i) => (
                  <button
                    key={h.path}
                    type="button"
                    role="option"
                    aria-selected={i === quickIndex}
                    className={`wire-project-quickopen-item${
                      i === quickIndex ? " active" : ""
                    }${dirtyPaths.has(h.path) ? " is-dirty" : ""}`}
                    onMouseEnter={() => setQuickIndex(i)}
                    onClick={() => openPath(h.path)}
                  >
                    <span className="wire-project-quickopen-name">{h.name}</span>
                    <span className="wire-project-quickopen-path">{h.path}</span>
                    {dirtyPaths.has(h.path) ? (
                      <span className="wire-project-tree-dirty" title="已修改" />
                    ) : null}
                  </button>
                ))
              )}
            </div>
            <div className="wire-project-quickopen-foot">
              ↑↓ 选择 · ↵ 打开 · Esc 关闭 · ⌘P
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TreeNode({
  node,
  depth,
  activePath,
  dirtyPaths,
  forceOpen,
  onOpen,
}: {
  node: ProjectTreeNode;
  depth: number;
  activePath: string;
  dirtyPaths: Set<string>;
  forceOpen?: boolean;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  // Auto-expand ancestors when navigating to a nested active file
  useEffect(() => {
    if (node.kind !== "folder") return;
    if (isPathUnderFolder(node.path, activePath) && activePath !== node.path) {
      setOpen(true);
    }
  }, [activePath, node.kind, node.path]);
  const expanded = forceOpen || open;
  if (node.kind === "folder") {
    const folderDirty = (node.children ?? []).some(
      (c) =>
        dirtyPaths.has(c.path) ||
        (c.children ?? []).some((gc) => dirtyPaths.has(gc.path)),
    );
    const hasActive = isPathUnderFolder(node.path, activePath);
    return (
      <div className="wire-project-tree-folder">
        <button
          type="button"
          className={`wire-project-tree-row is-folder${
            hasActive && activePath !== node.path ? " has-active" : ""
          }`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen((v) => !v)}
          title={node.path}
        >
          <span className="wire-project-twist" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
          <ChromeMark kind="folder_group" size={13} decorative />
          <span className="wire-project-tree-name">{node.name}</span>
          {folderDirty ? (
            <span className="wire-project-tree-dirty" title="含子文件改动" />
          ) : null}
        </button>
        {expanded
          ? (node.children ?? []).map((c) => (
              <TreeNode
                key={c.path}
                node={c}
                depth={depth + 1}
                activePath={activePath}
                dirtyPaths={dirtyPaths}
                forceOpen={forceOpen}
                onOpen={onOpen}
              />
            ))
          : null}
      </div>
    );
  }
  const active = node.path === activePath;
  const dirty = dirtyPaths.has(node.path);
  return (
    <button
      type="button"
      data-project-path={node.path}
      className={`wire-project-tree-row is-file${active ? " active" : ""}${
        dirty ? " is-dirty" : ""
      }`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onOpen(node.path)}
      title={dirty ? `${node.path} · 已修改` : node.path}
    >
      <span className="wire-project-twist" aria-hidden />
      <ChromeMark kind="files" size={13} decorative />
      <span className="wire-project-tree-name">{node.name}</span>
      {dirty ? (
        <span className="wire-project-tree-dirty" title="已修改" aria-label="已修改" />
      ) : null}
      {node.docKind ? (
        <span className="wire-project-tree-badge">
          {projectDocKindLabel(node.docKind)}
        </span>
      ) : null}
    </button>
  );
}
