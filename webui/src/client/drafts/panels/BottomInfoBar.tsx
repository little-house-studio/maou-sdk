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
  DockCanvasFace,
} from "../../dock-plugin";
import {
  DOCK_CLICK_SLOP_PX,
  DOCK_EXPAND_H_UI,
  DOCK_EXPAND_W_UI,
  DOCK_PREVIEW_W_MIN,
  DOCK_EAR_RISE_H,
  DOCK_STRIP_BODY_H,
  DOCK_TAB_H,
  DOCK_TAB_W,
  DOCK_TRACK_H,
  FOLDER,
  FOLDER_SCALE,
  SPRING_CLOSE,
  SPRING_OPEN,
  applyDockDragMove,
  boardHeightForPanel,
  boardPlacementFromSlot,
  boardTiltDeg,
  boardWidthForPanel,
  bottomYFromCssHeight,
  buildFolderPath,
  createDockDragSession,
  defaultDockOrder,
  dockCardById,
  dockTabZIndex,
  folderViewBox,
  hoverTextOpacity,
  lerpBoardPos,
  resolveDockPointerUp,
  rightXFromCssWidth,
  shouldStowFloat,
  springSettled,
  springStep,
  stepHoverProgress,
  stripWidthForHoverProgress,
  stowProgressFromHeight,
  type BoardPos,
  type DockCardId,
  type DockDragSession,
} from "../bottom-dock";

/** @deprecated alias */
export type BottomTabId = DockCardId;

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
};

type FloatPos = BoardPos;

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

function cardTitle(
  id: DockCardId,
  ctx: {
    logCount: number;
    termHint: string;
    agentName: string;
    agentStatus: string;
    taskRunning: number;
    taskTotal: number;
  },
): string {
  switch (id) {
    case "logs":
      return `${ctx.logCount} 条日志 · 应用/终端`;
    case "terminal":
      return ctx.termHint || "终端 · 模拟无 PTY";
    case "agent":
      return `${ctx.agentName} · ${ctx.agentStatus}`;
    case "tasks":
      return ctx.taskRunning > 0
        ? `${ctx.taskRunning}/${ctx.taskTotal} 任务运行中`
        : ctx.taskTotal > 0
          ? `${ctx.taskTotal} 项后台任务`
          : "暂无后台任务";
  }
}

/** Short preview line shown on hover (title + 预览). */
function cardPreviewLine(
  id: DockCardId,
  ctx: {
    termLines: string[];
    logs: string[];
    agentName: string;
    agentStatus: string;
    bgTasks?: DraftBgTask[];
  },
): string {
  switch (id) {
    case "logs":
      return ctx.logs[ctx.logs.length - 1] || "暂无新日志";
    case "terminal":
      return ctx.termLines[ctx.termLines.length - 1] || "（终端空）";
    case "agent":
      return `${ctx.agentName} · ${ctx.agentStatus}`;
    case "tasks": {
      const run = (ctx.bgTasks ?? []).find((t) => t.status === "running");
      return run?.title || (ctx.bgTasks?.[0]?.title ?? "暂无后台任务");
    }
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
  }
}

/** Preview width grows with title (design: only right edge H expands). */
function previewWidthPx(title: string, preview: string): number {
  const approx = 56 + Math.min(title.length + preview.length * 0.35, 40) * 7;
  return Math.min(440, Math.max(DOCK_PREVIEW_W_MIN, approx));
}

/**
 * One continuous folder geometry for tab → preview → expand.
 * Path topology fixed (ear); only rightX / bottomY change; CSS size lockstep.
 *
 * `hoverProgress` 0..1 morphs strip width (right edge only) between tab and
 * preview — use with rAF so the path does not jump / stretch-deform the ear.
 */
export function dockCardGeometry(opts: {
  phase: "tab" | "preview" | "expand";
  title?: string;
  preview?: string;
  panelH?: number;
  /** 0 = tab width, 1 = full preview width (right edge only). */
  hoverProgress?: number;
}): {
  phase: "tab" | "preview" | "expand";
  cssW: number;
  cssH: number;
  rightX: number;
  bottomY: number;
  pathD: string;
  viewBox: string;
  textOpacity: number;
} {
  if (opts.phase === "expand") {
    const panel = Math.max(0, opts.panelH ?? 0);
    const cssH = boardHeightForPanel(panel);
    const cssW = boardWidthForPanel(panel);
    const rightX = rightXFromCssWidth(cssW);
    const bottomY = bottomYFromCssHeight(cssH);
    return {
      phase: "expand",
      cssW,
      cssH,
      rightX,
      bottomY,
      pathD: buildFolderPath(rightX, bottomY),
      viewBox: folderViewBox(rightX, bottomY),
      textOpacity: 1,
    };
  }
  // Strip: continuous morph tab ↔ preview via hoverProgress
  const hp = Math.max(0, Math.min(1, opts.hoverProgress ?? 0));
  const previewW = previewWidthPx(opts.title ?? "", opts.preview ?? "");
  const cssW = stripWidthForHoverProgress(hp, previewW);
  const cssH = DOCK_TAB_H;
  const rightX = rightXFromCssWidth(cssW);
  const bottomY = FOLDER.stripBottom;
  const phase: "tab" | "preview" = hp > 0.02 ? "preview" : "tab";
  return {
    phase,
    cssW,
    cssH,
    rightX,
    bottomY,
    pathD: buildFolderPath(rightX, bottomY),
    viewBox: folderViewBox(rightX, bottomY),
    textOpacity: hoverTextOpacity(hp),
  };
}

type EarMode = "pending" | "open" | "float" | "reorder";

/**
 * Bottom dock:
 * - idle: 功能名 + 事件数
 * - hover: 标题 + 预览
 * - expand: 标题 + 详细 的可自由拖放悬浮窗；拖到底收纳
 * - 标签可排序；越靠右 z-index 越高
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

  const titleCtx = {
    logCount: logs.length,
    termHint: termLines[termLines.length - 1] || "终端就绪",
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
  const previewCtx = {
    termLines,
    logs,
    agentName: name,
    agentStatus: st.label,
    bgTasks,
  };

  const [order, setOrder] = useState<DockCardId[]>(() => defaultDockOrder());
  const [hoverId, setHoverId] = useState<DockCardId | null>(null);
  /**
   * Continuous strip morph: which card is expanding + progress 0..1.
   * Path right edge grows; label/badge stay; title/preview fade in after width.
   */
  const [hoverAnim, setHoverAnim] = useState<{
    id: DockCardId | null;
    t: number;
  }>({ id: null, t: 0 });
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
  const hoverRafRef = useRef(0);
  const hoverAnimRef = useRef(hoverAnim);
  const dragRef = useRef<DockDragSession | null>(null);
  const earModeRef = useRef<EarMode>("pending");
  const detachDocListenersRef = useRef<(() => void) | null>(null);
  const slotRefs = useRef<Partial<Record<DockCardId, HTMLElement | null>>>({});
  const trackRef = useRef<HTMLDivElement | null>(null);
  hoverAnimRef.current = hoverAnim;
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

  // Hover strip: animate path right edge (tab → preview), then reveal text
  const liveIdForHover: DockCardId | null =
    panelH > 0 ? (openId ?? pullingId) : null;
  useEffect(() => {
    const wantId =
      hoverId &&
      !dragging &&
      !pressing &&
      reorderId == null &&
      liveIdForHover == null
        ? hoverId
        : null;

    if (hoverRafRef.current) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = 0;
    }

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.048, (now - last) / 1000);
      last = now;
      const prev = hoverAnimRef.current;
      let id = prev.id;
      let t = prev.t;

      if (wantId) {
        if (id !== wantId) {
          // switch card: snap previous closed, grow the new one
          id = wantId;
          t = 0;
        }
        t = stepHoverProgress(t, 1, dt);
      } else {
        t = stepHoverProgress(t, 0, dt);
        if (t <= 0.001) {
          id = null;
          t = 0;
        }
      }

      const next = { id, t };
      hoverAnimRef.current = next;
      setHoverAnim(next);

      const settled = wantId
        ? id === wantId && t >= 0.999
        : t <= 0.001 && id == null;
      if (!settled) {
        hoverRafRef.current = requestAnimationFrame(tick);
      } else {
        hoverRafRef.current = 0;
      }
    };

    hoverRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (hoverRafRef.current) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = 0;
      }
    };
  }, [hoverId, dragging, pressing, reorderId, liveIdForHover]);

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
      const r = slot.getBoundingClientRect();
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
  const placeBoardOnSlot = useCallback(
    (id: DockCardId, panel: number) => {
      const anchor = slotAnchorRef.current ?? captureSlotAnchor(id);
      const boardW = boardWidthForPanel(panel);
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
    [captureSlotAnchor, setFloat],
  );

  const runSpringTo = useCallback(
    (target: number, id: DockCardId | null) => {
      stopSpring();
      setPopping(true);
      const open = target > 0 && id != null;
      const startH = Math.max(panelHRef.current, 1);
      if (open) {
        setOpen(id);
        setSlotAnchored(true);
        slotAnchoredRef.current = true;
        stowFromRef.current = null;
        captureSlotAnchor(id);
        placeBoardOnSlot(id, panelHRef.current || target * 0.15);
      } else {
        // Stow: remember free pos so board slides back into the slot while shrinking
        const slot =
          slotAnchorRef.current ??
          (id || openIdRef.current
            ? captureSlotAnchor((id ?? openIdRef.current) as DockCardId)
            : { left: 24, bottom: window.innerHeight - 4 });
        if (floatPosRef.current) {
          stowFromRef.current = {
            pos: { ...floatPosRef.current },
            height: startH,
            slot,
          };
        }
      }
      springRef.current = {
        x: panelHRef.current,
        v: springRef.current.v,
      };
      let last = performance.now();
      const tick = (now: number) => {
        const dt = now - last;
        last = now;
        const opts = open ? SPRING_OPEN : SPRING_CLOSE;
        springRef.current = springStep(springRef.current, target, dt, opts);
        const x = Math.max(0, springRef.current.x);
        setPanel(x);

        if (open && id && slotAnchoredRef.current) {
          // Grow upward from slot bottom — continuous board lift
          placeBoardOnSlot(id, x);
        } else if (!open && stowFromRef.current) {
          // Slide + shrink back into rack
          const prog = stowProgressFromHeight(x, stowFromRef.current.height);
          const boardH = boardHeightForPanel(x);
          const boardW = boardWidthForPanel(x);
          const slotTarget = boardPlacementFromSlot(
            stowFromRef.current.slot,
            boardW,
            boardH,
            window.innerWidth,
            window.innerHeight,
          );
          setFloat(lerpBoardPos(stowFromRef.current.pos, slotTarget, prog));
        }

        if (springSettled(springRef.current, target)) {
          setPanel(target);
          springRef.current = { x: target, v: 0 };
          setPopping(false);
          rafRef.current = 0;
          setBoardTilt(0);
          if (!open) {
            setOpen(null);
            setPullingId(null);
            setFloat(null);
            stowFromRef.current = null;
            slotAnchorRef.current = null;
            setSlotAnchored(true);
            slotAnchoredRef.current = true;
            onCollapse?.();
          } else {
            setOpen(id);
            setPullingId(null);
            // Keep slot-anchored until user free-moves
            if (id && slotAnchoredRef.current) placeBoardOnSlot(id, target);
            onTabChange?.(id!);
            onExpand?.();
          }
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [
      captureSlotAnchor,
      onCollapse,
      onExpand,
      onTabChange,
      placeBoardOnSlot,
      setFloat,
      setOpen,
      setPanel,
      stopSpring,
    ],
  );

  useEffect(
    () => () => {
      stopSpring();
      clearDocListeners();
    },
    [stopSpring, clearDocListeners],
  );

  const stowCard = useCallback(() => {
    setHoverId(null);
    setPullingId(null);
    setBoardTilt(0);
    springRef.current = {
      x: panelHRef.current,
      v: Math.min(springRef.current.v, -280),
    };
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
        springRef.current = {
          x: panelHRef.current,
          v: result.velocityKick,
        };
        runSpringTo(0, null);
        return;
      }

      if (
        result.kind === "click-open" ||
        result.kind === "click-switch" ||
        result.kind === "spring-switch"
      ) {
        setHoverId(null);
        setPullingId(null);
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
        runSpringTo(result.targetH, result.id);
        return;
      }

      springRef.current = {
        x: panelHRef.current,
        v: result.velocityKick,
      };
      if (result.open) {
        setPullingId(null);
        setOpen(result.id);
        setSlotAnchored(true);
        slotAnchoredRef.current = true;
        captureSlotAnchor(result.id);
        placeBoardOnSlot(result.id, panelHRef.current);
        onTabChange?.(result.id);
        onExpand?.();
        runSpringTo(result.targetH, result.id);
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
      placeBoardOnSlot,
      runSpringTo,
      setOpen,
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
    setPressing(true);
    setHoverId(null);
    setBoardTilt(0);

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
        const w = boardWidthForPanel(panelHRef.current);
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
            if (out.height > 2) {
              setSlotAnchored(true);
              slotAnchoredRef.current = true;
              placeBoardOnSlot(d.id, out.height);
            }
          }
          if (d.kind === "open" && out.provisionalOpen) {
            setPullingId(d.id);
            setOpen(d.id);
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
          /* body band only — rail top = folder 折角, not ear tip */
          "--dock-strip-body-h": `${DOCK_STRIP_BODY_H}px`,
          "--dock-ear-rise-h": `${DOCK_EAR_RISE_H}px`,
          "--folder-scale": String(FOLDER_SCALE),
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
        {orderedCards.map((card, index) => {
          const isLive = liveId === card.id;
          const isOpen = openId === card.id;
          const hoverT =
            !isLive && hoverAnim.id === card.id ? hoverAnim.t : 0;
          const isHovering = hoverT > 0.02;
          const title = cardTitle(card.id, titleCtx);
          const preview = cardPreviewLine(card.id, previewCtx);
          const count = cardCount(card.id, countCtx);
          const geo = dockCardGeometry({
            phase: isLive ? "expand" : "tab",
            title,
            preview,
            panelH: isLive ? panelH : 0,
            hoverProgress: isLive ? 0 : hoverT,
          });
          // Rightmost = highest z among docked; live board always topmost
          const zDock = dockTabZIndex(index, orderedCards.length);
          const z = isLive ? 80 : isHovering ? 40 + zDock : zDock;
          const isReordering = reorderId === card.id;
          const lifting = isLive && slotAnchored;
          const textOp = isLive ? 1 : geo.textOpacity;

          // Live board is always fixed once we have a placement (from slot lift)
          const floatStyle: React.CSSProperties =
            isLive && floatPos
              ? {
                  position: "fixed",
                  left: floatPos.left,
                  top: floatPos.top,
                  width: geo.cssW,
                  height: geo.cssH,
                  zIndex: z,
                  transform:
                    boardTilt !== 0
                      ? `rotate(${boardTilt}deg)`
                      : undefined,
                  transformOrigin: "50% 100%",
                }
              : {
                  width: geo.cssW,
                  height: geo.cssH,
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
                    height: DOCK_TAB_H,
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
                  <FolderShapeSvg
                    className="wire-dock-card-svg"
                    pathD={geo.pathD}
                    viewBox={geo.viewBox}
                  />
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
                          className="wire-dock-folder-head"
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
                          <span className="wire-dock-open-title">{title}</span>
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
                            />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
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
                isHovering ? "is-raised is-preview" : "",
                isLive ? "is-raised is-live" : "",
                isReordering ? "is-reorder" : "",
                pressing && dragRef.current?.id === card.id ? "is-press" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={floatStyle}
              title={`${title} · ${preview}`}
              onMouseEnter={() => {
                if (!dragging && !pressing && !isLive) setHoverId(card.id);
              }}
              onMouseLeave={() => {
                setHoverId((h) => (h === card.id ? null : h));
              }}
            >
              <FolderShapeSvg
                className="wire-dock-card-svg"
                pathD={geo.pathD}
                viewBox={geo.viewBox}
              />
              <div className="wire-dock-card-ui" data-folder-ui="overlay">
                <button
                  type="button"
                  className="wire-dock-card-ear"
                  data-folder-part="ear"
                  title="上拉展开 · 左右拖排序"
                  onPointerDown={(e) => beginEarPress(card.id, e)}
                >
                  {/* Label + badge always present; path grows right, then text fades in */}
                  {/* Always keep 功能名 + 数; hover only ADDS title/preview */}
                  <span className="wire-dock-tab-label">{card.label}</span>
                  <span className="wire-dock-tab-badge">{count}</span>
                  <span
                    className="wire-dock-tab-extra"
                    data-hover-text="true"
                    style={{
                      opacity: textOp,
                      /* grow available space with progress so text is additive not swapped */
                      flexGrow: textOp > 0.01 ? 1 : 0,
                      flexBasis: textOp > 0.01 ? "auto" : 0,
                      width: textOp > 0.01 ? undefined : 0,
                      pointerEvents: textOp < 0.05 ? "none" : undefined,
                    }}
                    aria-hidden={textOp < 0.05}
                  >
                    <span className="wire-dock-tab-title">{title}</span>
                    <span className="wire-dock-tab-preview">{preview}</span>
                  </span>
                </button>

                {isLive && panelH > 20 ? (
                  <div
                    className="wire-dock-card-body"
                    data-folder-part="body"
                  >
                    <header className="wire-dock-folder-head">
                      <span className="wire-dock-open-title">{title}</span>
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
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        <div className="wire-dock-track-fill" aria-hidden />
      </div>
    </footer>
  );
}

function FolderShapeSvg({
  className,
  pathD,
  viewBox,
}: {
  className?: string;
  pathD: string;
  viewBox: string;
}) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <path
        d={pathD}
        fill="var(--dock-fill, #A182FF)"
        data-folder-path={pathD}
      />
    </svg>
  );
}

const TASK_STATUS_ZH: Record<DraftBgTask["status"], string> = {
  running: "进行中",
  done: "完成",
  queued: "排队",
};

const TONE_ACCENT: Record<string, string> = {
  logs: "#ff5a2e",
  tasks: "#c9c2b6",
  terminal: "#b8ff00",
  agent: "#a182ff",
};

/** Shared plugin registry for draft dock boards (canvas-ui / html-canvas). */
const DOCK_PLUGIN_REG = createDefaultDockRegistry();

/**
 * Expanded board face — free canvas host (dock-plugin).
 * Each card paints its own canvas (or HTML-in-canvas) independent of siblings.
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
        accent={TONE_ACCENT[id]}
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

