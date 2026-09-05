/**
 * Draft project node canvas — Project Graph core ops wired to pure helpers.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  broadGrow,
  connectNodes,
  createTextNode,
  deepGrow,
  deleteEdge,
  deleteSelection,
  duplicateSelection,
  getNode,
  graphBounds,
  historyCommit,
  historyInit,
  historyRedo,
  historyUndo,
  graphToMermaid,
  layoutChildren,
  moveNode,
  navigateTree,
  reverseEdge,
  selectNode,
  selectRoot,
  snapGraphToGrid,
  snapNodeToGrid,
  updateNodeText,
  type GraphHistory,
  type ProjectGraphState,
} from "./project-graph";

export type ProjectCanvasProps = {
  graph: ProjectGraphState;
  onChange: (next: ProjectGraphState) => void;
  onRebuildFromOutline?: () => void;
  /** Push graph tree into Markdown outline (parent confirms / applies). */
  onWriteOutlineToMd?: () => void;
  /** Jump to matching MD heading for selected node title. */
  onLocateSource?: (title: string) => void;
  /** Node label finished editing — parent may sync MD heading. */
  onNodeRename?: (oldTitle: string, newTitle: string) => void;
  /** When set, pan/select this node once (outline → canvas). */
  focusNodeId?: string | null;
  onFocusNodeHandled?: () => void;
};

type DragState =
  | null
  | {
      kind: "move";
      id: string;
      ox: number;
      oy: number;
      startX: number;
      startY: number;
    }
  | {
      kind: "connect";
      fromId: string;
      x: number;
      y: number;
    }
  | {
      kind: "pan";
      sx: number;
      sy: number;
      camX: number;
      camY: number;
    };

export function ProjectCanvas({
  graph,
  onChange,
  onRebuildFromOutline,
  onWriteOutlineToMd,
  onLocateSource,
  onNodeRename,
  focusNodeId,
  onFocusNodeHandled,
}: ProjectCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState({ x: 40, y: 40, scale: 1 });
  const [drag, setDrag] = useState<DragState>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [hist, setHist] = useState<GraphHistory>(() => historyInit(graph));
  const [toast, setToast] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [snapGrid, setSnapGrid] = useState(true);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const editStartTextRef = useRef("");
  // Path switch / 从大纲重建 remount via parent key= — history resets with mount.

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1400);
  };

  const beginEdit = (nodeId: string) => {
    const n = getNode(graphRef.current, nodeId);
    editStartTextRef.current = n?.text ?? "";
    setEditingId(nodeId);
    setSelectedEdgeId(null);
  };

  const finishEdit = (nodeId: string) => {
    const n = getNode(graphRef.current, nodeId);
    const oldT = editStartTextRef.current;
    const newT = n?.text ?? "";
    setEditingId(null);
    if (onNodeRename && oldT !== newT) onNodeRename(oldT, newT);
  };

  const apply = useCallback(
    (next: ProjectGraphState) => {
      setHist((h) => historyCommit(h, next));
      onChange(next);
    },
    [onChange],
  );

  const undo = useCallback(() => {
    setHist((h) => {
      const n = historyUndo(h);
      if (n === h) return h;
      onChange(n.present);
      return n;
    });
  }, [onChange]);

  const redo = useCallback(() => {
    setHist((h) => {
      const n = historyRedo(h);
      if (n === h) return h;
      onChange(n.present);
      return n;
    });
  }, [onChange]);

  const worldFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const el = surfaceRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      return {
        x: (clientX - r.left - camera.x) / camera.scale,
        y: (clientY - r.top - camera.y) / camera.scale,
      };
    },
    [camera],
  );

  const fitView = useCallback(() => {
    const el = surfaceRef.current;
    const b = graphBounds(graph);
    if (!el || !b) return;
    const pad = 48;
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    const scale = Math.min(
      1.4,
      Math.max(0.4, Math.min((vw - pad * 2) / w, (vh - pad * 2) / h)),
    );
    const x = (vw - w * scale) / 2 - b.minX * scale;
    const y = (vh - h * scale) / 2 - b.minY * scale;
    setCamera({ x, y, scale });
  }, [graph]);

  const centerSelection = useCallback(() => {
    const el = surfaceRef.current;
    const id = graph.selectedId;
    if (!el || !id) return;
    const node = getNode(graph, id);
    if (!node) return;
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    setCamera((c) => ({
      ...c,
      x: el.clientWidth / 2 - cx * c.scale,
      y: el.clientHeight / 2 - cy * c.scale,
    }));
  }, [graph]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        if (!editingId) {
          e.preventDefault();
          setSpaceDown(true);
        }
        return;
      }

      if (editingId) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const sel = graph.selectedId
          ? getNode(graph, graph.selectedId)
          : null;
        if (sel) {
          e.preventDefault();
          void navigator.clipboard?.writeText(sel.text);
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void (async () => {
          try {
            const text = (await navigator.clipboard?.readText())?.trim();
            if (!text) return;
            const label = text.split("\n")[0]!.slice(0, 80) || "粘贴";
            apply(
              createTextNode(graphRef.current, {
                text: label,
                x: 120 + graphRef.current.nodes.length * 12,
                y: 100 + graphRef.current.nodes.length * 16,
              }),
            );
          } catch {
            /* clipboard denied */
          }
        })();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        apply(deepGrow(graph));
        return;
      }
      if (e.key === "\\" || e.key === "、") {
        e.preventDefault();
        apply(broadGrow(graph));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (selectedEdgeId) {
          apply(deleteEdge(graph, selectedEdgeId));
          setSelectedEdgeId(null);
        } else {
          apply(deleteSelection(graph));
        }
        return;
      }
      if (e.key === "Enter" && graph.selectedId) {
        e.preventDefault();
        beginEdit(graph.selectedId);
        return;
      }
      if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        apply(duplicateSelection(graph));
        setSelectedEdgeId(null);
        return;
      }
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        apply(createTextNode(graph, { text: "新节点" }));
        setSelectedEdgeId(null);
        return;
      }
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        fitView();
        return;
      }
      if ((e.key === "l" || e.key === "L") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        apply(layoutChildren(graph));
        return;
      }
      if ((e.key === "c" || e.key === "C") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        centerSelection();
        return;
      }
      if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey) {
        if (selectedEdgeId) {
          e.preventDefault();
          apply(reverseEdge(graph, selectedEdgeId));
          return;
        }
      }
      if ((e.key === "0" || e.code === "Digit0") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCamera((c) => ({ ...c, scale: 1 }));
        return;
      }
      if (e.key === "Home" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const next = selectRoot(graph);
        apply(next);
        return;
      }
      // G = go to source (matching heading in MD)
      if ((e.key === "g" || e.key === "G") && !e.metaKey && !e.ctrlKey) {
        const sel = graph.selectedId
          ? getNode(graph, graph.selectedId)
          : null;
        if (sel && onLocateSource) {
          e.preventDefault();
          onLocateSource(sel.text);
          return;
        }
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        apply(navigateTree(graph, "parent"));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        apply(navigateTree(graph, "firstChild"));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        apply(navigateTree(graph, "prevSibling"));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        apply(navigateTree(graph, "nextSibling"));
        return;
      }
      if (e.key === "Escape") {
        setConnectMode(false);
        setEditingId(null);
        setSelectedEdgeId(null);
        apply(selectNode(graph, null));
      }
    },
    [
      apply,
      centerSelection,
      editingId,
      fitView,
      graph,
      onLocateSource,
      redo,
      selectedEdgeId,
      undo,
    ],
  );

  const onKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === " " || e.code === "Space") {
      setSpaceDown(false);
    }
  }, []);

  useEffect(() => {
    surfaceRef.current?.focus({ preventScroll: true });
  }, []);

  // Non-passive wheel: pan (trackpad/mouse) or ⌃/⌘ zoom — Project Graph–like
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setCamera((c) => ({
          ...c,
          scale: Math.min(2.5, Math.max(0.35, c.scale * delta)),
        }));
        return;
      }
      // Shift+wheel → horizontal pan when deltaX is 0 (mouse)
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      setCamera((c) => ({
        ...c,
        x: c.x - dx,
        y: c.y - dy,
      }));
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  useEffect(() => {
    if (!focusNodeId) return;
    const node = getNode(graph, focusNodeId);
    if (!node) {
      onFocusNodeHandled?.();
      return;
    }
    apply(selectNode(graph, focusNodeId));
    const el = surfaceRef.current;
    if (el) {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      setCamera((c) => ({
        ...c,
        x: el.clientWidth / 2 - cx * c.scale,
        y: el.clientHeight / 2 - cy * c.scale,
      }));
    }
    surfaceRef.current?.focus({ preventScroll: true });
    onFocusNodeHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId]);

  const onPointerDownSurface = (e: React.PointerEvent) => {
    if (
      e.button === 1 ||
      (e.button === 0 && (e.altKey || spaceDown))
    ) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({
        kind: "pan",
        sx: e.clientX,
        sy: e.clientY,
        camX: camera.x,
        camY: camera.y,
      });
      return;
    }
    if (e.target === e.currentTarget) {
      if (editingId) setEditingId(null);
      setSelectedEdgeId(null);
      apply(selectNode(graph, null));
    }
  };

  const onDoubleClickSurface = (e: React.MouseEvent) => {
    if (
      e.target !== e.currentTarget &&
      (e.target as HTMLElement).dataset?.layer !== "edges"
    ) {
      return;
    }
    const w = worldFromClient(e.clientX, e.clientY);
    const next = createTextNode(graph, {
      text: "新节点",
      x: w.x - 80,
      y: w.y - 22,
    });
    apply(next);
    if (next.selectedId) setEditingId(next.selectedId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      setCamera((c) => ({
        ...c,
        x: drag.camX + (e.clientX - drag.sx),
        y: drag.camY + (e.clientY - drag.sy),
      }));
      return;
    }
    if (drag.kind === "move") {
      const w = worldFromClient(e.clientX, e.clientY);
      // live move without flooding history — commit on pointer up
      onChange(moveNode(graphRef.current, drag.id, w.x - drag.ox, w.y - drag.oy));
      return;
    }
    if (drag.kind === "connect") {
      const w = worldFromClient(e.clientX, e.clientY);
      setDrag({ ...drag, x: w.x, y: w.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag?.kind === "connect") {
      const w = worldFromClient(e.clientX, e.clientY);
      const hit = hitTestNode(graph, w.x, w.y);
      if (hit && hit !== drag.fromId) {
        apply(connectNodes(graph, drag.fromId, hit));
      }
    }
    if (drag?.kind === "move") {
      // record final position in history only when position actually changed
      let final = graphRef.current;
      const before = getNode(final, drag.id);
      if (snapGrid) {
        final = snapNodeToGrid(final, drag.id, 8);
      }
      const after = getNode(final, drag.id);
      const moved =
        !!before &&
        !!after &&
        (Math.abs(after.x - drag.startX) > 0.5 ||
          Math.abs(after.y - drag.startY) > 0.5);
      if (moved) apply(final);
    }
    setDrag(null);
  };

  const selected = graph.selectedId
    ? getNode(graph, graph.selectedId)
    : null;
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;

  return (
    <div className="wire-project-graph" aria-label="节点画布">
      <div className="wire-project-graph-toolbar" role="toolbar">
        <div className="wire-project-graph-toolbar-primary">
          <button
            type="button"
            className="wire-project-action"
            onClick={() => apply(createTextNode(graph, { text: "新节点" }))}
            title="新建文本节点 N"
          >
            新建
          </button>
          <button
            type="button"
            className={`wire-project-action${connectMode ? " is-active" : ""}`}
            aria-pressed={connectMode}
            onClick={() => setConnectMode((v) => !v)}
            title="连线模式：先点起点，再点终点"
          >
            连线
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!graph.selectedId}
            onClick={() => apply(deepGrow(graph))}
            title="深度生长 Tab"
          >
            深度
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!graph.selectedId}
            onClick={() => apply(broadGrow(graph))}
            title="广度生长 \\"
          >
            广度
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!graph.selectedId && !selectedEdgeId}
            onClick={() => {
              if (selectedEdgeId) {
                apply(deleteEdge(graph, selectedEdgeId));
                setSelectedEdgeId(null);
              } else {
                apply(deleteSelection(graph));
              }
            }}
            title="删除选中节点或连线 Delete"
          >
            删除
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!canUndo}
            onClick={undo}
            title="撤销 ⌘Z"
          >
            撤销
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!canRedo}
            onClick={redo}
            title="重做 ⌘⇧Z"
          >
            重做
          </button>
          <button
            type="button"
            className="wire-project-action wire-project-zoom"
            onClick={() => setCamera((c) => ({ ...c, scale: 1 }))}
            title="重置缩放 0"
          >
            {Math.round(camera.scale * 100)}%
          </button>
          <button
            type="button"
            className={`wire-project-action${showMore ? " is-active" : ""}`}
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
            title="更多工具"
          >
            更多{showMore ? "▴" : "▾"}
          </button>
        </div>
        <div
          className={`wire-project-graph-toolbar-more${
            showMore ? " is-open" : ""
          }`}
          hidden={!showMore}
        >
          <button
            type="button"
            className="wire-project-action"
            disabled={!graph.selectedId}
            onClick={() => apply(duplicateSelection(graph))}
            title="复制节点 D"
          >
            复制
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!selectedEdgeId}
            onClick={() => {
              if (!selectedEdgeId) return;
              apply(reverseEdge(graph, selectedEdgeId));
            }}
            title="反转连线方向 R"
          >
            反转边
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!graph.selectedId}
            onClick={() => apply(layoutChildren(graph))}
            title="整理子节点 L"
          >
            排版
          </button>
          <button
            type="button"
            className="wire-project-action"
            disabled={!graph.selectedId}
            onClick={centerSelection}
            title="居中选中 C"
          >
            居中
          </button>
          <button
            type="button"
            className="wire-project-action"
            onClick={fitView}
            title="适应视图 F"
          >
            适应
          </button>
          <button
            type="button"
            className={`wire-project-action${snapGrid ? " is-active" : ""}`}
            aria-pressed={snapGrid}
            onClick={() => {
              setSnapGrid((v) => {
                const next = !v;
                if (next) apply(snapGraphToGrid(graph, 8));
                return next;
              });
            }}
            title="拖动结束吸附 8px 网格；开启时对齐全部节点"
          >
            吸附
          </button>
          {onRebuildFromOutline ? (
            <button
              type="button"
              className="wire-project-action"
              onClick={onRebuildFromOutline}
              title="从当前 Markdown 大纲重建图"
            >
              从大纲重建
            </button>
          ) : null}
          {onWriteOutlineToMd ? (
            <button
              type="button"
              className="wire-project-action"
              onClick={onWriteOutlineToMd}
              title="用当前图结构覆盖 Markdown 大纲标题"
            >
              写入大纲
            </button>
          ) : null}
          {onLocateSource ? (
            <button
              type="button"
              className="wire-project-action"
              disabled={!graph.selectedId}
              onClick={() => {
                const sel = graph.selectedId
                  ? getNode(graph, graph.selectedId)
                  : null;
                if (sel) onLocateSource(sel.text);
              }}
              title="定位到源码中的同名标题 G"
            >
              到源码
            </button>
          ) : null}
          <button
            type="button"
            className="wire-project-action"
            onClick={() => {
              const md = graphToMermaid(graph);
              void (async () => {
                try {
                  await navigator.clipboard?.writeText(md);
                  flash("已复制 Mermaid");
                } catch {
                  flash("复制失败");
                }
              })();
            }}
            title="复制为 Mermaid flowchart"
          >
            Mermaid
          </button>
          <button
            type="button"
            className="wire-project-action"
            onClick={() => apply(selectRoot(graph))}
            title="选中根节点 Home"
          >
            根节点
          </button>
        </div>
        <span className="wire-project-graph-hint">
          滚轮平移 · ⌃滚轮缩放 · Tab/\\ · 更多▾ · ⌘Z
        </span>
      </div>
      {toast ? (
        <div className="wire-project-graph-toast" role="status">
          {toast}
        </div>
      ) : null}

      <div
        ref={surfaceRef}
        className={`wire-project-graph-surface${spaceDown ? " is-panning" : ""}`}
        tabIndex={0}
        role="application"
        aria-label="Project Graph 画布"
        data-canvas="project-graph"
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPointerDown={onPointerDownSurface}
        onDoubleClick={onDoubleClickSurface}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {graph.nodes.length === 0 ? (
          <div className="wire-project-graph-empty" aria-hidden>
            <p>画布为空</p>
            <p className="wire-project-graph-empty-hint">
              双击空白新建 · N 新建 · Tab 生长 · 或「从大纲重建」
            </p>
          </div>
        ) : null}
        <div
          className="wire-project-graph-world"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          }}
        >
          <svg
            className="wire-project-graph-edges"
            data-layer="edges"
          >
            {graph.edges.map((edge) => {
              const a = getNode(graph, edge.from);
              const b = getNode(graph, edge.to);
              if (!a || !b) return null;
              const x1 = a.x + a.width;
              const y1 = a.y + a.height / 2;
              const x2 = b.x;
              const y2 = b.y + b.height / 2;
              const edgeActive = edge.id === selectedEdgeId;
              return (
                <g key={edge.id}>
                  {/* wide invisible hit target */}
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className="wire-project-edge-hit"
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      setSelectedEdgeId(edge.id);
                      apply(selectNode(graph, null));
                    }}
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    className={`wire-project-edge-line${
                      edgeActive ? " is-selected" : ""
                    }`}
                    markerEnd="url(#pg-arrow)"
                    pointerEvents="none"
                  />
                </g>
              );
            })}
            {drag?.kind === "connect" ? (
              (() => {
                const a = getNode(graph, drag.fromId);
                if (!a) return null;
                return (
                  <line
                    x1={a.x + a.width / 2}
                    y1={a.y + a.height / 2}
                    x2={drag.x}
                    y2={drag.y}
                    className="wire-project-edge-line is-draft"
                  />
                );
              })()
            ) : null}
            <defs>
              <marker
                id="pg-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  className="wire-project-edge-arrow"
                />
              </marker>
            </defs>
          </svg>

          {graph.nodes.map((node) => {
            const active = node.id === graph.selectedId;
            const isEdit = editingId === node.id;
            return (
              <div
                key={node.id}
                className={`wire-project-node${active ? " is-selected" : ""}`}
                data-node-id={node.id}
                style={{
                  left: node.x,
                  top: node.y,
                  width: node.width,
                  minHeight: node.height,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (spaceDown || e.altKey) return;
                  setSelectedEdgeId(null);
                  if (connectMode || e.shiftKey) {
                    if (graph.selectedId && graph.selectedId !== node.id) {
                      apply(connectNodes(graph, graph.selectedId, node.id));
                      setConnectMode(false);
                    } else {
                      apply(selectNode(graph, node.id));
                      const w = worldFromClient(e.clientX, e.clientY);
                      setDrag({
                        kind: "connect",
                        fromId: node.id,
                        x: w.x,
                        y: w.y,
                      });
                      (e.currentTarget as HTMLElement).setPointerCapture(
                        e.pointerId,
                      );
                    }
                    return;
                  }
                  apply(selectNode(graph, node.id));
                  const w = worldFromClient(e.clientX, e.clientY);
                  setDrag({
                    kind: "move",
                    id: node.id,
                    ox: w.x - node.x,
                    oy: w.y - node.y,
                    startX: node.x,
                    startY: node.y,
                  });
                  (e.currentTarget as HTMLElement).setPointerCapture(
                    e.pointerId,
                  );
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  apply(selectNode(graph, node.id));
                  beginEdit(node.id);
                }}
              >
                {isEdit ? (
                  <input
                    className="wire-project-node-input"
                    autoFocus
                    value={node.text}
                    onChange={(ev) =>
                      apply(updateNodeText(graph, node.id, ev.target.value))
                    }
                    onBlur={() => finishEdit(node.id)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") {
                        ev.preventDefault();
                        finishEdit(node.id);
                        surfaceRef.current?.focus();
                      }
                      if (ev.key === "Escape") {
                        ev.preventDefault();
                        // revert label
                        apply(
                          updateNodeText(
                            graph,
                            node.id,
                            editStartTextRef.current,
                          ),
                        );
                        setEditingId(null);
                        surfaceRef.current?.focus();
                      }
                      if (ev.key === "Tab") {
                        ev.preventDefault();
                        finishEdit(node.id);
                        apply(deepGrow(graphRef.current));
                      }
                      if (ev.key === "\\") {
                        ev.preventDefault();
                        finishEdit(node.id);
                        apply(broadGrow(graphRef.current));
                      }
                    }}
                    onPointerDown={(ev) => ev.stopPropagation()}
                  />
                ) : (
                  <span className="wire-project-node-text">{node.text}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="wire-project-graph-status" aria-live="polite">
        <span>
          节点 {graph.nodes.length} · 边 {graph.edges.length}
          {canUndo || canRedo
            ? ` · 历史 ${hist.past.length}/${hist.future.length}`
            : ""}
        </span>
        {selected ? (
          <span className="wire-project-graph-sel">选中 {selected.text}</span>
        ) : selectedEdgeId ? (
          <span className="wire-project-graph-sel">选中连线</span>
        ) : (
          <span className="wire-project-graph-sel">未选中</span>
        )}
      </div>
    </div>
  );
}

function hitTestNode(
  graph: ProjectGraphState,
  x: number,
  y: number,
): string | null {
  for (let i = graph.nodes.length - 1; i >= 0; i--) {
    const n = graph.nodes[i]!;
    if (
      x >= n.x &&
      x <= n.x + n.width &&
      y >= n.y &&
      y <= n.y + n.height
    ) {
      return n.id;
    }
  }
  return null;
}
