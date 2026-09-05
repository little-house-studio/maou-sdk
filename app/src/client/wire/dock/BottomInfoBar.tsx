import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DraftAgent, DraftBgTask, DraftMeta } from "../types";
import { statusMarkKind } from "../visual-marks";
import {
  createDefaultDockRegistry,
  getDockPlugin,
  resolveDockBoardLayout,
  readDockBoardSize,
  writeDockBoardSize,
  clampDockBoardSize,
  dockViewportSizeLimits,
  DockCanvasFace,
  DockBoardShell,
  type DockFaceMap,
  type DockBoardLayout,
  type DockBoardSize,
} from "../../dock-plugin";
import {
  DOCK_CLICK_SLOP_PX,
  DOCK_EXPAND_H_UI,
  DOCK_TAB_H,
  DOCK_TAB_W,
  DOCK_TRACK_H,
  DOCK_STRIP_BODY_H,
  OPEN_KICK_V,
  SPRING_OPEN,
  STOW_EASE_S,
  applyDockDragMove,
  easeCloseHeight,
  easeCloseProgress,
  easeOpenHeight,
  boardHeightForPanel,
  boardPlacementFromSlot,
  boardTiltDeg,
  boardWidthForPanel,
  createDockDragSession,
  defaultDockOrder,
  dockCardById,
  dockTabZIndex,
  lerpBoardPos,
  resolveDockPointerUp,
  shouldStowFloat,
  springSettled,
  springStep,
  type BoardPos,
  type DockCardId,
  type DockDragSession,
} from "../../dock-plugin/bottom-dock";

/** @deprecated alias */
export type BottomTabId = DockCardId;

/** Shared plugin registry — layout + contentKind source of truth. */
const DOCK_PLUGIN_REG = createDefaultDockRegistry();

export type BottomInfoBarProps = {
  termLines: string[];
  bgTasks?: DraftBgTask[];
  meta: DraftMeta;
  activeAgent: DraftAgent | null;
  agentBusy: boolean;
  agents?: DraftAgent[];
  height?: number;
  collapsed?: boolean;
  activeTab?: BottomTabId;
  onTabChange?: (tab: BottomTabId) => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  onReservedHeightChange?: (px: number) => void;
  /**
   * React faces by card id (e.g. terminal, proactive).
   * Prefer this over one-off `*Face` props — any new board only needs a map entry.
   */
  faces?: DockFaceMap;
  /**
   * @deprecated use `faces.terminal` — kept for DraftShell / gradual migration
   */
  terminalFace?: React.ReactNode;
  /**
   * @deprecated use `faces.proactive`
   */
  proactiveFace?: React.ReactNode;
  /**
   * Programmatic open (e.g. Ctrl+` / tool-card attach).
   * Bump `nonce` each request so the same tab re-opens after stow.
   */
  openTabRequest?: { tab: DockCardId; nonce: number } | null;
};

type FloatPos = BoardPos;
type BoardResizeEdge = "e" | "s" | "se";

function layoutFor(id: DockCardId): DockBoardLayout {
  return resolveDockBoardLayout(DOCK_PLUGIN_REG, id);
}

function resolveStatus(
  agentBusy: boolean,
  agent: DraftAgent | null,
): {
  label: string;
  kind: ReturnType<typeof statusMarkKind>;
} {
  if (agentBusy || agent?.status === "running") {
    return { label: "运行中", kind: "running" };
  }
  if (agent?.status === "blocked") return { label: "待操作", kind: "blocked" };
  if (agent?.status === "needs_reply")
    return { label: "待回复", kind: "needs_reply" };
  if (agent?.status === "done_unread")
    return { label: "完成·未读", kind: "done_unread" };
  if (agent?.status === "done_read")
    return { label: "完成", kind: "done_read" };
  return { label: "空闲", kind: "idle" };
}

function logLinesFrom(
  termLines: string[],
  meta: DraftMeta,
  agentBusy: boolean,
): string[] {
  const stamp = new Date().toISOString().slice(11, 19);
  const head = [
    `[${stamp}] INFO  draft shell ready`,
    `[${stamp}] INFO  agent=${meta.agentName} sandbox=${meta.sandboxMode}`,
    `[${stamp}] INFO  model=${meta.provider || "—"}/${meta.model || "—"}`,
  ];
  if (agentBusy) head.push(`[${stamp}] WARN  agent busy / streaming`);
  const fromTerm = termLines
    .filter(Boolean)
    .slice(0, 40)
    .map((l) => `[term] ${l}`);
  return [...head, ...fromTerm];
}

/**
 * Expanded / strip title on the folder head.
 * Must stay short chrome labels — never dump raw term/log lines into the
 * manila ear (that produced "$ ready · no agent terminals" on lime fill).
 */
function cardTitle(
  id: DockCardId,
  ctx: {
    logCount: number;
    termCount: number;
    agentName: string;
    agentStatus: string;
    taskRunning: number;
    taskTotal: number;
  },
): string {
  switch (id) {
    case "logs":
      return ctx.logCount > 0 ? `日志 · ${ctx.logCount}` : "日志";
    case "terminal":
      // Fixed chrome only; live status lives in TerminalPanel toolbar
      return ctx.termCount > 0 ? `终端 · ${ctx.termCount}` : "终端";
    case "agent":
      return `${ctx.agentName} · ${ctx.agentStatus}`;
    case "tasks":
      return ctx.taskRunning > 0
        ? `任务 · ${ctx.taskRunning}/${ctx.taskTotal}`
        : ctx.taskTotal > 0
          ? `任务 · ${ctx.taskTotal}`
          : "任务";
    case "proactive":
      return "主动智能";
  }
}

function cardCount(
  id: DockCardId,
  ctx: {
    logCount: number;
    termLines: number;
    agentBusy: boolean;
    taskRunning: number;
    taskTotal: number;
  },
): number {
  switch (id) {
    case "logs":
      return Math.min(99, ctx.logCount);
    case "terminal":
      return Math.min(99, Math.max(0, ctx.termLines));
    case "agent":
      return ctx.agentBusy ? 1 : 0;
    case "tasks":
      return ctx.taskRunning || ctx.taskTotal;
    case "proactive":
      return 0;
  }
}

/**
 * Rect tab / raised board size. Tab is a fixed chip; expand grows height.
 */
export function dockCardGeometry(opts: {
  phase: "tab" | "preview" | "expand";
  panelH?: number;
}): {
  phase: "tab" | "expand";
  cssW: number;
  cssH: number;
} {
  if (opts.phase === "expand") {
    const panel = Math.max(0, opts.panelH ?? 0);
    return {
      phase: "expand",
      cssW: boardWidthForPanel(panel),
      cssH: boardHeightForPanel(panel),
    };
  }
  return {
    phase: "tab",
    cssW: DOCK_TAB_W,
    cssH: DOCK_TAB_H,
  };
}

type EarMode = "pending" | "open" | "float" | "reorder";

/**
 * Bottom dock:
 * - idle: 矩形标签（功能名 + 事件数）
 * - expand: 点击弹出矩形浮板；拖标题挪窗，拖到底收纳
 * - 标签可横拖排序；越靠右 z-index 越高
 */
export function BottomInfoBar({
  termLines,
  bgTasks,
  meta,
  activeAgent,
  agentBusy,
  agents = [],
  onTabChange,
  onExpand,
  onCollapse,
  onReservedHeightChange,
  faces,
  terminalFace,
  proactiveFace,
  openTabRequest,
}: BottomInfoBarProps) {
  const name = activeAgent?.name ?? meta.agentName;
  const st = resolveStatus(agentBusy, activeAgent);
  const logs = useMemo(
    () => logLinesFrom(termLines, meta, agentBusy),
    [termLines, meta, agentBusy],
  );
  const taskRunning = (bgTasks ?? []).filter((t) => t.status === "running")
    .length;
  const taskTotal = (bgTasks ?? []).length;

  /** Merge map + legacy one-off props (map wins). */
  const faceMap = useMemo<DockFaceMap>(() => {
    const m: DockFaceMap = { ...(faces ?? {}) };
    if (terminalFace != null && m.terminal == null) m.terminal = terminalFace;
    if (proactiveFace != null && m.proactive == null) m.proactive = proactiveFace;
    return m;
  }, [faces, terminalFace, proactiveFace]);

  const titleCtx = {
    logCount: logs.length,
    termCount: termLines.length,
    agentName: name,
    agentStatus: st.label,
    taskRunning,
    taskTotal,
  };
  const countCtx = {
    logCount: logs.length,
    termLines: termLines.length,
    agentBusy,
    taskRunning,
    taskTotal,
  };
  const [order, setOrder] = useState<DockCardId[]>(() => defaultDockOrder());
  /**
   * Remembered open sizes (w always; h used when resizable or custom default).
   * Keyed by DockCardId — driven by DockBoardLayout, not per-card if/else.
   */
  const [boardSizeById, setBoardSizeById] = useState<
    Partial<Record<DockCardId, DockBoardSize>>
  >(() => {
    const init: Partial<Record<DockCardId, DockBoardSize>> = {};
    for (const c of defaultDockOrder()) {
      init[c] = readDockBoardSize(layoutFor(c));
    }
    return init;
  });
  const boardSizeRef = useRef(boardSizeById);
  boardSizeRef.current = boardSizeById;

  const sizeFor = useCallback((id: DockCardId): DockBoardSize => {
    const layout = layoutFor(id);
    const remembered = boardSizeRef.current[id];
    if (remembered) return clampDockBoardSize(remembered, layout);
    return readDockBoardSize(layout);
  }, []);

  const setSizeFor = useCallback((id: DockCardId, size: DockBoardSize) => {
    const next = clampDockBoardSize(size, layoutFor(id));
    boardSizeRef.current = { ...boardSizeRef.current, [id]: next };
    setBoardSizeById((prev) => ({ ...prev, [id]: next }));
    return next;
  }, []);
  const [openId, setOpenId] = useState<DockCardId | null>(null);
  const [panelH, setPanelH] = useState(0);
  const [floatPos, setFloatPos] = useState<FloatPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const [popping, setPopping] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [pullingId, setPullingId] = useState<DockCardId | null>(null);
  const [reorderId, setReorderId] = useState<DockCardId | null>(null);
  /** Board still growing from slot bottom (not free-handed yet). */
  const [slotAnchored, setSlotAnchored] = useState(true);
  /** Free-drag tilt (deg) for in-hand feel. */
  const [boardTilt, setBoardTilt] = useState(0);

  const panelHRef = useRef(0);
  const openIdRef = useRef<DockCardId | null>(null);
  const floatPosRef = useRef<FloatPos | null>(null);
  const orderRef = useRef(order);
  const springRef = useRef({ x: 0, v: 0 });
  const rafRef = useRef(0);
  const dragRef = useRef<DockDragSession | null>(null);
  const liveSnapRef = useRef(false);
  const earModeRef = useRef<EarMode>("pending");
  const detachDocListenersRef = useRef<(() => void) | null>(null);
  const slotRefs = useRef<Partial<Record<DockCardId, HTMLElement | null>>>({});
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** Slot bottom/left captured at pull start for bottom-edge lift. */
  const slotAnchorRef = useRef<{ left: number; bottom: number } | null>(null);
  const slotAnchoredRef = useRef(true);
  /** Stow: start float pos + start height for lerp-back into rack. */
  const stowFromRef = useRef<{
    pos: FloatPos;
    height: number;
    slot: { left: number; bottom: number };
  } | null>(null);

  orderRef.current = order;
  slotAnchoredRef.current = slotAnchored;

  const setPanel = useCallback((h: number) => {
    const v = Math.max(0, h);
    panelHRef.current = v;
    setPanelH(v);
  }, []);

  const setOpen = useCallback((id: DockCardId | null) => {
    openIdRef.current = id;
    setOpenId(id);
  }, []);

  const setFloat = useCallback((pos: FloatPos | null) => {
    floatPosRef.current = pos;
    setFloatPos(pos);
  }, []);

  useEffect(() => {
    onReservedHeightChange?.(DOCK_TRACK_H);
  }, [onReservedHeightChange]);

  const stopSpring = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setPopping(false);
  }, []);

  const clearDocListeners = useCallback(() => {
    detachDocListenersRef.current?.();
    detachDocListenersRef.current = null;
  }, []);

  const captureSlotAnchor = useCallback((id: DockCardId) => {
    const slot = slotRefs.current[id];
    if (slot) {
      const prev = slot.style.transform;
      slot.style.transform = "none";
      const r = slot.getBoundingClientRect();
      slot.style.transform = prev;
      slotAnchorRef.current = { left: r.left, bottom: r.bottom };
      return slotAnchorRef.current;
    }
    slotAnchorRef.current = {
      left: 24,
      bottom: window.innerHeight - 4,
    };
    return slotAnchorRef.current;
  }, []);

  /**
   * Place / re-place board with bottom edge on the slot strip
   * (folder board lifting out of the rack).
   */
  const boardWFor = useCallback(
    (id: DockCardId, _panel: number) => sizeFor(id).w,
    [sizeFor],
  );

  /** Open height from layout (remembered or default), clamped. */
  const openHFor = useCallback(
    (id: DockCardId) => sizeFor(id).h,
    [sizeFor],
  );

  const placeBoardOnSlot = useCallback(
    (id: DockCardId, panel: number) => {
      const anchor = slotAnchorRef.current ?? captureSlotAnchor(id);
      const boardW = boardWFor(id, panel);
      const boardH = boardHeightForPanel(panel);
      const pos = boardPlacementFromSlot(
        anchor,
        boardW,
        boardH,
        window.innerWidth,
        window.innerHeight,
      );
      setFloat(pos);
      return pos;
    },
    [boardWFor, captureSlotAnchor, setFloat],
  );

  /** Generic edge resize for any layout.resizable board. */
  const beginBoardResize = useCallback(
    (id: DockCardId, edge: BoardResizeEdge, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const layout = layoutFor(id);
      if (!layout.resizable) return;
      e.preventDefault();
      e.stopPropagation();
      stopSpring();
      setBoardTilt(0);
      // free-hand resize: leave slot anchor so SE grows down/right naturally
      if (edge !== "e") {
        setSlotAnchored(false);
        slotAnchoredRef.current = false;
      }
      const startX = e.clientX;
      const startY = e.clientY;
      const cur = sizeFor(id);
      const startW = cur.w;
      const startH = panelHRef.current;
      const startLeft = floatPosRef.current?.left ?? 0;
      const startTop = floatPosRef.current?.top ?? 0;
      const free = !slotAnchoredRef.current;
      const minW = layout.minWidth ?? 200;
      const minH = layout.minHeight ?? 96;

      const onMove = (ev: PointerEvent) => {
        const { wMax, hMax } = dockViewportSizeLimits(layout);
        let w = startW;
        let h = startH;
        if (edge === "e" || edge === "se") {
          w = Math.min(wMax, Math.max(minW, startW + (ev.clientX - startX)));
        }
        if (edge === "s" || edge === "se") {
          h = Math.min(hMax, Math.max(minH, startH + (ev.clientY - startY)));
        }
        setSizeFor(id, { w, h });
        panelHRef.current = h;
        setPanel(h);
        springRef.current = { x: h, v: 0 };
        if (free) {
          setFloat({ left: startLeft, top: startTop });
        } else if (openIdRef.current === id) {
          placeBoardOnSlot(id, h);
        }
      };
      const onUp = () => {
        const latest = sizeFor(id);
        writeDockBoardSize(layout, {
          w: latest.w,
          h: panelHRef.current,
        });
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [placeBoardOnSlot, setFloat, setPanel, setSizeFor, sizeFor, stopSpring],
  );

  const finishClose = useCallback(() => {
    setPanel(0);
    springRef.current = { x: 0, v: 0 };
    setPopping(false);
    rafRef.current = 0;
    setBoardTilt(0);
    setOpen(null);
    setPullingId(null);
    setFloat(null);
    stowFromRef.current = null;
    slotAnchorRef.current = null;
    setSlotAnchored(true);
    slotAnchoredRef.current = true;
    liveSnapRef.current = false;
    onCollapse?.();
  }, [onCollapse, setFloat, setOpen, setPanel]);

  const runSpringTo = useCallback(
    (target: number, id: DockCardId | null) => {
      stopSpring();
      const open = target > 0 && id != null;
      const startH = Math.max(panelHRef.current, 1);
      if (open) {
        setPopping(true);
        setOpen(id);
        setSlotAnchored(true);
        slotAnchoredRef.current = true;
        stowFromRef.current = null;
        captureSlotAnchor(id);
        placeBoardOnSlot(id, panelHRef.current || target * 0.15);
        const reduceMotion =
          typeof matchMedia === "function" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduceMotion) {
          const fromH = panelHRef.current;
          const t0 = performance.now();
          const tick = (now: number) => {
            const p = easeCloseProgress((now - t0) / 1000, STOW_EASE_S);
            const x = easeOpenHeight(fromH, target, p);
            springRef.current = { x, v: 0 };
            setPanel(x);
            if (id && slotAnchoredRef.current) placeBoardOnSlot(id, x);
            if (p >= 1) {
              setPanel(target);
              springRef.current = { x: target, v: 0 };
              setPopping(false);
              rafRef.current = 0;
              setBoardTilt(0);
              setOpen(id);
              setPullingId(null);
              if (slotAnchoredRef.current) placeBoardOnSlot(id, target);
              onTabChange?.(id);
              onExpand?.();
              return;
            }
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        springRef.current = {
          x: panelHRef.current,
          v: springRef.current.v,
        };
        let last = performance.now();
        const tick = (now: number) => {
          const dt = now - last;
          last = now;
          springRef.current = springStep(
            springRef.current,
            target,
            dt,
            SPRING_OPEN,
          );
          const x = Math.max(0, springRef.current.x);
          setPanel(x);
          if (id && slotAnchoredRef.current) {
            placeBoardOnSlot(id, x);
          }
          if (springSettled(springRef.current, target)) {
            setPanel(target);
            springRef.current = { x: target, v: 0 };
            setPopping(false);
            rafRef.current = 0;
            setBoardTilt(0);
            setOpen(id);
            setPullingId(null);
            if (slotAnchoredRef.current) placeBoardOnSlot(id, target);
            onTabChange?.(id);
            onExpand?.();
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Close: short ease into the slot — no oscillating spring
      setPopping(false);
      const closeId = (id ?? openIdRef.current) as DockCardId | null;
      const slot = closeId
        ? captureSlotAnchor(closeId)
        : (slotAnchorRef.current ?? {
            left: 24,
            bottom: window.innerHeight - 4,
          });
      const slideHome =
        !slotAnchoredRef.current && floatPosRef.current != null;
      if (slideHome && floatPosRef.current) {
        stowFromRef.current = {
          pos: { ...floatPosRef.current },
          height: startH,
          slot,
        };
      } else {
        stowFromRef.current = null;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = easeCloseProgress((now - t0) / 1000, STOW_EASE_S);
        const x = easeCloseHeight(startH, p);
        springRef.current = { x, v: 0 };
        setPanel(x);
        if (stowFromRef.current) {
          const boardH = boardHeightForPanel(x);
          const stowId = (id ?? openIdRef.current) as DockCardId | null;
          const boardW = stowId
            ? boardWFor(stowId, x)
            : boardWidthForPanel(x);
          const slotTarget = boardPlacementFromSlot(
            stowFromRef.current.slot,
            boardW,
            boardH,
            window.innerWidth,
            window.innerHeight,
          );
          setFloat(lerpBoardPos(stowFromRef.current.pos, slotTarget, p));
        } else if (closeId && floatPosRef.current) {
          // Slot-pinned retract: keep the bottom on the rack (no p² lerp).
          placeBoardOnSlot(closeId, x);
        }
        if (p >= 1) {
          finishClose();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [
      boardWFor,
      captureSlotAnchor,
      finishClose,
      onExpand,
      onTabChange,
      placeBoardOnSlot,
      setFloat,
      setOpen,
      setPanel,
      stopSpring,
    ],
  );

  // Live shell / tool-card: open a dock board by request (not the old float panel)
  useEffect(() => {
    if (!openTabRequest?.tab) return;
    const id = openTabRequest.tab;
    // Reload persisted size for this board
    setSizeFor(id, readDockBoardSize(layoutFor(id)));
    const targetH = openHFor(id);
    setPullingId(null);
    setSlotAnchored(true);
    slotAnchoredRef.current = true;
    captureSlotAnchor(id);
    setOpen(id);
    placeBoardOnSlot(id, panelHRef.current || targetH * 0.2);
    onTabChange?.(id);
    onExpand?.();
    springRef.current = { x: panelHRef.current, v: 420 };
    runSpringTo(targetH, id);
    // openTabRequest.nonce intentionally drives re-open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabRequest?.nonce, openTabRequest?.tab]);

  useEffect(
    () => () => {
      stopSpring();
      clearDocListeners();
    },
    [stopSpring, clearDocListeners],
  );

  const stowCard = useCallback(() => {
    setPullingId(null);
    setBoardTilt(0);
    liveSnapRef.current = false;
    springRef.current = { x: panelHRef.current, v: 0 };
    runSpringTo(0, null);
  }, [runSpringTo]);

  const finishOpenPull = useCallback(
    (session: DockDragSession, clientY: number) => {
      const result = resolveDockPointerUp(
        session,
        openIdRef.current,
        panelHRef.current,
        clientY,
      );

      if (result.kind === "click-noop") {
        setPullingId(null);
        return;
      }

      if (result.kind === "click-close") {
        setPullingId(null);
        springRef.current = { x: panelHRef.current, v: 0 };
        runSpringTo(0, null);
        return;
      }

      if (
        result.kind === "click-open" ||
        result.kind === "click-switch" ||
        result.kind === "spring-switch"
      ) {
        setPullingId(null);
        setSizeFor(result.id, readDockBoardSize(layoutFor(result.id)));
        setOpen(result.id);
        setSlotAnchored(true);
        slotAnchoredRef.current = true;
        captureSlotAnchor(result.id);
        placeBoardOnSlot(result.id, panelHRef.current);
        onTabChange?.(result.id);
        onExpand?.();
        springRef.current = {
          x: panelHRef.current,
          v: result.velocityKick,
        };
        runSpringTo(openHFor(result.id), result.id);
        return;
      }

      springRef.current = {
        x: panelHRef.current,
        v: result.velocityKick,
      };
      if (result.open) {
        setPullingId(null);
        setSizeFor(result.id, readDockBoardSize(layoutFor(result.id)));
        setOpen(result.id);
        setSlotAnchored(true);
        slotAnchoredRef.current = true;
        captureSlotAnchor(result.id);
        placeBoardOnSlot(result.id, panelHRef.current);
        onTabChange?.(result.id);
        onExpand?.();
        runSpringTo(openHFor(result.id), result.id);
      } else {
        if (openIdRef.current == null) setPullingId(session.id);
        else setPullingId(null);
        runSpringTo(0, null);
      }
    },
    [
      captureSlotAnchor,
      onExpand,
      onTabChange,
      openHFor,
      placeBoardOnSlot,
      runSpringTo,
      setOpen,
      setSizeFor,
    ],
  );

  /**
   * Ear pointer machine:
   * - docked: axis lock → vertical = pull board open; horizontal = reorder; click = pop open
   * - expanded: free-move board; release near bottom = stow into rack
   */
  const beginEarPress = (id: DockCardId, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    clearDocListeners();
    stopSpring();
    liveSnapRef.current = false;
    setPressing(true);
    setBoardTilt(0);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is optional */
    }

    const isLive =
      (openIdRef.current === id && panelHRef.current > 2) ||
      (pullingId === id && panelHRef.current > 2);
    const origin = floatPosRef.current ?? { left: 0, top: 0 };

    if (
      isLive ||
      (openIdRef.current === id && panelHRef.current > DOCK_EXPAND_H_UI * 0.35)
    ) {
      // Free-hand the board — detach from slot pivot
      earModeRef.current = "float";
      setSlotAnchored(false);
      slotAnchoredRef.current = false;
      dragRef.current = createDockDragSession(
        id,
        "float",
        e.pointerId,
        e.clientY,
        panelHRef.current,
        performance.now(),
        e.clientX,
        origin.left,
        origin.top,
      );
    } else {
      earModeRef.current = "pending";
      setSlotAnchored(true);
      slotAnchoredRef.current = true;
      captureSlotAnchor(id);
      dragRef.current = createDockDragSession(
        id,
        "open",
        e.pointerId,
        e.clientY,
        panelHRef.current,
        performance.now(),
        e.clientX,
      );
    }

    const pressOpenId = openIdRef.current;

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== ev.pointerId) return;

      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      const travel = Math.hypot(dx, dy);

      // Axis resolve for docked pending
      if (earModeRef.current === "pending" && travel >= DOCK_CLICK_SLOP_PX) {
        if (Math.abs(dx) > Math.abs(dy) * 1.15) {
          earModeRef.current = "reorder";
          d.kind = "reorder";
          setReorderId(d.id);
          setDragging(true);
          setPressing(false);
        } else {
          earModeRef.current = "open";
          d.kind = "open";
          setDragging(true);
          setPressing(false);
          captureSlotAnchor(d.id);
        }
      }

      if (earModeRef.current === "reorder") {
        setDragging(true);
        setPressing(false);
        const allCenters: { id: DockCardId; cx: number }[] = [];
        for (const oid of orderRef.current) {
          const el = slotRefs.current[oid];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          allCenters.push({
            id: oid,
            cx: oid === d.id ? ev.clientX : r.left + r.width / 2,
          });
        }
        allCenters.sort((a, b) => a.cx - b.cx);
        const newOrder = allCenters.map((c) => c.id);
        if (
          newOrder.length === orderRef.current.length &&
          newOrder.join() !== orderRef.current.join()
        ) {
          setOrder(newOrder);
        }
        d.moved = true;
        d.maxTravel = Math.max(d.maxTravel, travel);
        return;
      }

      if (earModeRef.current === "float") {
        setDragging(true);
        setPressing(false);
        d.moved = travel >= DOCK_CLICK_SLOP_PX || d.moved;
        d.maxTravel = Math.max(d.maxTravel, travel);
        const left = d.originLeft + (ev.clientX - d.startX);
        const top = d.originTop + (ev.clientY - d.startY);
        const w = boardWFor(d.id, panelHRef.current);
        const h = boardHeightForPanel(panelHRef.current);
        const clamped: FloatPos = {
          left: Math.max(4, Math.min(window.innerWidth - w - 4, left)),
          top: Math.max(4, Math.min(window.innerHeight - 40, top)),
        };
        setFloat(clamped);
        setBoardTilt(boardTiltDeg(dx));
        // Vel for stow (down positive)
        const dt = Math.max(1, performance.now() - d.lastT);
        d.vel = 0.65 * d.vel + 0.35 * ((ev.clientY - d.lastY) / dt);
        d.lastY = ev.clientY;
        d.lastT = performance.now();
        return;
      }

      // open pull / vertical — board lifts with bottom edge on slot
      if (earModeRef.current === "open" || earModeRef.current === "pending") {
        if (liveSnapRef.current) return;
        const out = applyDockDragMove(d, ev.clientY, performance.now(), {
          alreadyOpenId: pressOpenId,
        });
        dragRef.current = out.session;
        if (out.session.moved) {
          setDragging(true);
          setPressing(false);
          if (!out.freezeHeight) {
            setPanel(out.height);
            springRef.current = {
              x: out.height,
              v: out.session.vel * 1000,
            };
          }
          if (d.kind === "open" && out.provisionalOpen) {
            setPullingId(d.id);
            setOpen(d.id);
          }
          // Stay in-flow until breakaway — floating mid-pull collapses the rack.
          if (out.breakaway && !out.freezeHeight) {
            liveSnapRef.current = true;
            setPullingId(null);
            setOpen(d.id);
            springRef.current = { x: out.height, v: OPEN_KICK_V };
            runSpringTo(openHFor(d.id), d.id);
          }
        }
      }
    };

    const onUp = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== ev.pointerId) return;
      clearDocListeners();
      dragRef.current = null;
      setDragging(false);
      setPressing(false);
      setReorderId(null);
      const mode = earModeRef.current;
      earModeRef.current = "pending";

      if (mode === "reorder") {
        return;
      }

      if (mode === "float") {
        setBoardTilt(0);
        const pos = floatPosRef.current;
        const h = boardHeightForPanel(panelHRef.current);
        const bottom = (pos?.top ?? 0) + h;
        const stow =
          shouldStowFloat(bottom, window.innerHeight) ||
          d.vel > 0.42 ||
          (!d.moved && openIdRef.current === d.id);
        if (stow) {
          stowCard();
        }
        return;
      }

      if (liveSnapRef.current) {
        liveSnapRef.current = false;
        return;
      }

      // open / pending (click or pull)
      finishOpenPull(d, ev.clientY);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    detachDocListenersRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  };

  const liveId: DockCardId | null =
    panelH > 0 ? (openId ?? pullingId) : null;
  const expanded = liveId != null && panelH > 2;

  const orderedCards = useMemo(
    () => order.map((id) => dockCardById(id)),
    [order],
  );

  return (
    <footer
      className={[
        "wire-bottom-dock",
        expanded ? "is-expanded" : "is-docked",
        dragging ? "is-dragging" : "",
        popping ? "is-popping" : "",
        pressing ? "is-pressing" : "",
        reorderId ? "is-reordering" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--dock-track-h": `${DOCK_TRACK_H}px`,
          "--dock-strip-body-h": `${DOCK_STRIP_BODY_H}px`,
          height: DOCK_TRACK_H,
        } as React.CSSProperties
      }
      aria-label="底栏停靠卡片"
      data-dock-dragging={dragging ? "true" : "false"}
      data-dock-order={order.join(",")}
    >
      <div
        ref={trackRef}
        className="wire-dock-track"
        role="tablist"
        aria-label="停靠卡片"
      >
        <div className="wire-dock-track-fill" aria-hidden />
        {orderedCards.map((card, index) => {
          const isLive = liveId === card.id;
          const isOpen = openId === card.id;
          const title = cardTitle(card.id, titleCtx);
          const count = cardCount(card.id, countCtx);
          const geo = dockCardGeometry({
            phase: isLive ? "expand" : "tab",
            panelH: isLive ? panelH : 0,
          });
          const zDock = dockTabZIndex(index, orderedCards.length);
          const z = isLive ? 80 : zDock;
          const isReordering = reorderId === card.id;
          const lifting = isLive && slotAnchored;
          const liveW =
            isLive && floatPos ? boardWFor(card.id, panelH) : geo.cssW;
          const liveH = geo.cssH;
          const floatStyle: React.CSSProperties =
            isLive && floatPos
              ? {
                  position: "fixed",
                  left: floatPos.left,
                  top: floatPos.top,
                  width: liveW,
                  height: liveH,
                  zIndex: z,
                  transform:
                    boardTilt !== 0
                      ? `rotate(${boardTilt}deg)`
                      : undefined,
                  transformOrigin: "50% 100%",
                }
              : {
                  width: liveW,
                  height: isLive ? liveH : "100%",
                  zIndex: z,
                };

          // When board is out, keep a layout spacer in the track + fixed board
          if (isLive && floatPos) {
            return (
              <React.Fragment key={card.id}>
                <div
                  ref={(el) => {
                    slotRefs.current[card.id] = el;
                  }}
                  className="wire-dock-slot-spacer"
                  data-dock-slot={card.id}
                  style={{
                    width: DOCK_TAB_W,
                    height: "100%",
                    zIndex: zDock,
                  }}
                  aria-hidden
                />
                <div
                  role="tab"
                  aria-selected={isOpen}
                  aria-expanded
                  data-dock-card={card.id}
                  data-dock-phase="expand"
                  data-dock-float="true"
                  data-dock-anchored={lifting ? "true" : "false"}
                  className={[
                    "wire-dock-card",
                    `tone-${card.tone}`,
                    "is-raised",
                    "is-live",
                    "is-float",
                    lifting ? "is-lifting" : "is-free",
                    popping ? "is-popping" : "",
                    pressing ? "is-press" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={floatStyle}
                >
                  <div className="wire-dock-card-fill" aria-hidden />
                  <div className="wire-dock-card-ui" data-folder-ui="overlay">
                    <button
                      type="button"
                      className="wire-dock-card-ear"
                      data-folder-part="ear"
                      title="拖动窗口 · 拖到底部收纳"
                      onPointerDown={(e) => beginEarPress(card.id, e)}
                    >
                      <span className="wire-dock-tab-label">{card.label}</span>
                      <span className="wire-dock-tab-badge">{count}</span>
                    </button>
                    {panelH > 20 ? (
                      <div
                        className="wire-dock-card-body"
                        data-folder-part="body"
                      >
                        <header
                          className={
                            card.id === "terminal"
                              ? "wire-dock-folder-head is-face-chrome"
                              : "wire-dock-folder-head"
                          }
                          data-folder-part="drag"
                          title="拖动窗口 · 拖到底部收纳"
                          onPointerDown={(e) => {
                            // Title bar free-move (ignore close button)
                            if (
                              (e.target as HTMLElement).closest(
                                ".wire-dock-card-close",
                              )
                            ) {
                              return;
                            }
                            beginEarPress(card.id, e);
                          }}
                        >
                          {/* terminal: status lives in TerminalPanel toolbar — no $ready on lime */}
                          <span className="wire-dock-open-title">
                            {card.id === "terminal" ? "" : title}
                          </span>
                          <button
                            type="button"
                            className="wire-dock-card-close"
                            onClick={stowCard}
                            aria-label="收纳"
                            title="收纳到底栏"
                          >
                            ▾
                          </button>
                        </header>
                        <div
                          className="wire-dock-folder-content"
                          data-folder-part="face"
                        >
                          {panelH > 24 && openId === card.id ? (
                            <DockCardBody
                              id={openId}
                              termLines={termLines}
                              logs={logs}
                              meta={meta}
                              activeAgent={activeAgent}
                              agentBusy={agentBusy}
                              agents={agents}
                              st={st}
                              bgTasks={bgTasks}
                              title={title}
                              count={count}
                              faces={faceMap}
                            />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {/* Layout-driven resize grips (any resizable board) */}
                  {layoutFor(card.id).resizable && panelH > 24 ? (
                    <>
                      <div
                        className="wire-dock-resize wire-dock-resize-e"
                        data-resize="e"
                        title="拖动调整宽度"
                        onPointerDown={(ev) =>
                          beginBoardResize(card.id, "e", ev)
                        }
                      />
                      <div
                        className="wire-dock-resize wire-dock-resize-s"
                        data-resize="s"
                        title="拖动调整高度"
                        onPointerDown={(ev) =>
                          beginBoardResize(card.id, "s", ev)
                        }
                      />
                      <div
                        className="wire-dock-resize wire-dock-resize-se"
                        data-resize="se"
                        title="拖动调整大小"
                        onPointerDown={(ev) =>
                          beginBoardResize(card.id, "se", ev)
                        }
                      />
                    </>
                  ) : null}
                </div>
              </React.Fragment>
            );
          }

          return (
            <div
              key={card.id}
              ref={(el) => {
                slotRefs.current[card.id] = el;
              }}
              role="tab"
              aria-selected={isOpen}
              aria-expanded={false}
              data-dock-card={card.id}
              data-dock-phase={geo.phase}
              data-dock-index={index}
              className={[
                "wire-dock-card",
                `tone-${card.tone}`,
                isLive ? "is-raised is-live" : "",
                isLive && !floatPos ? "is-slot-pull" : "",
                isReordering ? "is-reorder" : "",
                pressing && dragRef.current?.id === card.id ? "is-press" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={floatStyle}
              title={title}
            >
              <div className="wire-dock-card-fill" aria-hidden />
              <div className="wire-dock-card-ui" data-folder-ui="overlay">
                <button
                  type="button"
                  className="wire-dock-card-ear"
                  data-folder-part="ear"
                  title="点击弹出 · 左右拖排序"
                  onPointerDown={(e) => beginEarPress(card.id, e)}
                >
                  <span className="wire-dock-tab-label">{card.label}</span>
                  <span className="wire-dock-tab-badge">{count}</span>
                </button>

                {isLive && panelH > 20 ? (
                  <div
                    className="wire-dock-card-body"
                    data-folder-part="body"
                  >
                    <header
                      className={
                        card.id === "terminal"
                          ? "wire-dock-folder-head is-face-chrome"
                          : "wire-dock-folder-head"
                      }
                    >
                      <span className="wire-dock-open-title">
                        {card.id === "terminal" ? "" : title}
                      </span>
                      <button
                        type="button"
                        className="wire-dock-card-close"
                        onClick={stowCard}
                        aria-label="收纳"
                        title="收纳"
                      >
                        ▾
                      </button>
                    </header>
                    <div
                      className="wire-dock-folder-content"
                      data-folder-part="face"
                    >
                      {panelH > 24 && openId === card.id ? (
                        <DockCardBody
                          id={openId}
                          termLines={termLines}
                          logs={logs}
                          meta={meta}
                          activeAgent={activeAgent}
                          agentBusy={agentBusy}
                          agents={agents}
                          st={st}
                          bgTasks={bgTasks}
                          title={title}
                          count={count}
                          faces={faceMap}
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </footer>
  );
}

const TASK_STATUS_ZH: Record<DraftBgTask["status"], string> = {
  running: "进行中",
  done: "完成",
  queued: "排队",
};

/**
 * Expanded board face — react face from map, else canvas/html preview.
 * Designers: pass `faces[id]` + layout.surface; no chrome edits needed.
 */
function DockCardBody({
  id,
  termLines,
  logs,
  meta,
  activeAgent,
  agentBusy,
  agents,
  st,
  bgTasks,
  title,
  count,
  faces,
}: {
  id: DockCardId;
  termLines: string[];
  logs: string[];
  meta: DraftMeta;
  activeAgent: DraftAgent | null;
  agentBusy: boolean;
  agents: DraftAgent[];
  st: { label: string; kind: ReturnType<typeof statusMarkKind> };
  bgTasks?: DraftBgTask[];
  title: string;
  count: number;
  faces?: DockFaceMap;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [faceSize, setFaceSize] = useState({ w: 240, h: 160 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setFaceSize({
        w: Math.max(8, Math.floor(r.width)),
        h: Math.max(8, Math.floor(r.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plugin = getDockPlugin(DOCK_PLUGIN_REG, id);
  const layout = layoutFor(id);
  const surface = layout.surface ?? "transparent";
  const reactFace = faces?.[id];

  // Generic react face mount (terminal, proactive, future boards)
  if (reactFace != null) {
    return (
      <DockBoardShell
        cardId={id}
        surface={surface}
        className={
          id === "terminal"
            ? "wire-dock-terminal-host"
            : id === "proactive"
              ? "wire-dock-proactive-host"
              : undefined
        }
      >
        {reactFace}
      </DockBoardShell>
    );
  }

  const contentKind = plugin?.contentKind ?? "canvas-ui";

  const taskLines = (bgTasks ?? []).map(
    (t) =>
      `${TASK_STATUS_ZH[t.status] ?? t.status} · ${t.title}${
        t.agent ? ` · ${t.agent}` : ""
      }`,
  );
  const agentList = agents.length
    ? agents.filter((a) => !a.stale).slice(0, 12)
    : activeAgent
      ? [activeAgent]
      : [];
  const agentLines = [
    `${activeAgent?.name ?? meta.agentName} · ${st.label}${
      agentBusy ? " · busy" : ""
    }`,
    meta.model || meta.provider || "—",
    ...agentList.map(
      (a) => `${a.displayName || a.name} · ${a.role} · ${a.status}`,
    ),
  ];

  return (
    <div
      ref={wrapRef}
      className="wire-dock-plugin-body"
      data-dock-body={id}
      data-dock-plugin={contentKind}
    >
      <DockCanvasFace
        cardId={id}
        contentKind={contentKind}
        title={title}
        count={count}
        accent="var(--dock-fill)"
        logs={logs}
        termLines={termLines}
        taskLines={taskLines}
        agentLines={agentLines}
        width={faceSize.w}
        height={faceSize.h}
      />
    </div>
  );
}

