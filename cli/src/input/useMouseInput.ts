/**
 * 三种选区：
 *  chat   —— 上下文框内起点：内容 absY 锚定 + 边缘自动滚 + 滚出视野的行进 lineCache
 *  global —— 框外起点：纯屏幕显存，不滚对话
 *  input  —— 输入框：字符选区，复制/删除
 * Shift+click 扩展 chat/global 锚点。
 *
 * 关键修复：
 *  - 滚动前先 capture，滚动后只改 logical metrics，paint 等 Ink 帧同步
 *  - 边缘外拖拽仍 pin 到视口边并持续 auto-scroll
 *  - 不在 edge timer 里 full+selection 双刷（减闪烁）
 */

import { useEffect, useRef } from "react";
import { enableMouse, disableMouse, parseMouse, type MouseEvent } from "./mouse.js";
import { hitTest, type LayoutRect } from "./hit-test.js";
import { hitTestClick } from "./click-target.js";
import { useStore } from "../state/store.js";
import {
  clearSelection,
  extractSelection,
  findWordAt,
  findLineBoundaries,
  snapToCell,
  captureChatVisibleLines,
  notifySelectionChanged,
} from "../render/vram-layer.js";
import {
  clearActiveSel,
  getActiveSel,
  getChatViewMetrics,
  getSelMode,
  getStickyAnchor,
  isPaintPending,
  pointInChat,
  screenToAbsY,
  setChatViewMetrics,
  setInputBounds,
  setLogicalChatViewMetrics,
  startChatSel,
  startGlobalSel,
  startInputSel,
  updateChatSelEnd,
  updateGlobalSelEnd,
  updateInputSelEnd,
} from "../render/selection-model.js";
import { copyToClipboard } from "./osc52.js";
import { setPointerShape, resetPointerShape, resolvePointerShape } from "./osc22.js";
import { selFxLive, selFxRelease, selFxClear } from "../render/sel-fx.js";
import { perfInc } from "../hooks/perf.js";
import { noteUiPhase } from "../hooks/process-stats.js";
import {
  HOVER_MIN_MS,
  TERM_BREAKPOINTS,
  INPUT_TEXT_COL_OFFSET_DEFAULT,
} from "../config/ui-constants.js";

/** inputRect 高度异常（如全屏编辑器残留）时不当作输入区，防止整屏 I 形光标 */
function isPlausibleInputRect(
  r: { left: number; top: number; width: number; height: number } | null | undefined,
): boolean {
  if (!r) return true; // 无实测矩形时走 hitTest 的行号回退
  if (r.width <= 0 || r.height <= 0) return false;
  // 输入槽最多约 4 行 + 边距；超过 10 行视为脏数据
  if (r.height > 10) return false;
  return true;
}

interface DragState {
  mode: "chat" | "global" | "input";
  startCol: number;
  startRow: number;
  moved: boolean;
  clickCount: number;
  wordMode: boolean;
  edgeDir: "up" | "down" | null;
}

const DRAG_THRESHOLD = 1;
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DIST = 3;
const EDGE_ZONE = 1;
const EDGE_MS = 32;
/** 拖选中 capture 行缓存节流 */
const CAPTURE_MIN_MS = 80;

export interface MouseCallbacks {
  onInputCursor?: (charIndex: number, line: number) => void;
  onChatScroll?: (dir: "up" | "down") => void;
  onInputScroll?: (dir: "up" | "down") => void;
  onOverlayScroll?: (dir: "up" | "down") => void;
}

function termSize() {
  return {
    cols: process.stdout.columns || TERM_BREAKPOINTS.fallbackCols,
    rows: process.stdout.rows || TERM_BREAKPOINTS.fallbackRows,
  };
}

/** 优先用 ScrollHistory 实测视口，避免把 ↓回底 / 状态栏采进 lineCache */
function chatScreenRange(rect: LayoutRect): { top: number; bottom: number } {
  const vp = useStore.getState().chatViewport;
  if (vp && vp.height > 0 && vp.bottom >= vp.top) {
    return { top: vp.top, bottom: vp.bottom };
  }
  return { top: rect.chatTop, bottom: rect.chatBottom };
}

function syncChatMetrics(rect: LayoutRect) {
  const s = useStore.getState();
  const offset = s.autoFollow ? 0 : Math.min(s.chatScrollOffset, s.maxChatScroll);
  const { top, bottom } = chatScreenRange(rect);
  setChatViewMetrics({
    top,
    bottom,
    contentTopY: s.maxChatScroll - offset,
    maxScroll: s.maxChatScroll,
    offset,
  });
  if (rect.inputRect) {
    setInputBounds({
      left: rect.inputRect.left,
      top: rect.inputRect.top,
      width: rect.inputRect.width,
      height: rect.inputRect.height,
      textColOffset: rect.inputTextColOffset ?? INPUT_TEXT_COL_OFFSET_DEFAULT,
    });
  }
}

function toastCopy(text: string) {
  if (!text?.trim()) return;
  copyToClipboard(text);
  const n = text.length;
  const preview = text.replace(/\s+/g, " ").slice(0, 24);
  useStore.getState().toastMsg(
    n > 24 ? `已复制 ${n} 字「${preview}…」` : `已复制 ${n} 字`,
    "ok",
  );
}

function resolveMode(row: number, col: number, rows: number, rect: LayoutRect): "chat" | "global" | "input" {
  const hit = hitTest(col, row, rows, rect);
  if (hit.kind === "input") return "input";
  if (pointInChat(row, col, "logical")) return "chat";
  return "global";
}

/** 滚 1 行并只更新 logical metrics；调用前须已 capture */
function scrollChatLogical(dir: "up" | "down", rect: LayoutRect): void {
  // 滚前：整视口写入 cache。往上滚时底部行即将离开，必须在此帧收进 cache。
  // fillOnly:false 仅覆盖「当前可见 absY」；已滚出的 absY 不在循环内，不会被擦掉。
  captureChatVisibleLines({ alsoSticky: true, fillOnly: false });
  useStore.getState().scrollChat(dir, 1);
  const s = useStore.getState();
  const offset = s.autoFollow ? 0 : Math.min(s.chatScrollOffset, s.maxChatScroll);
  const { top, bottom } = chatScreenRange(rect);
  setLogicalChatViewMetrics({
    top,
    bottom,
    contentTopY: s.maxChatScroll - offset,
    maxScroll: s.maxChatScroll,
    offset,
  });
}

/** 边缘拖选：把 end 钉在视口顶/底（logical absY） */
function pinChatEndToEdge(dir: "up" | "down", col: number): void {
  const m = getChatViewMetrics("logical");
  if (dir === "down") {
    updateChatSelEnd(m.contentTopY + (m.bottom - m.top), Math.max(1, col));
  } else {
    updateChatSelEnd(m.contentTopY, Math.max(1, col));
  }
}

export function useMouseInput(enabled: boolean, rect: LayoutRect, cb: MouseCallbacks): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const dragRef = useRef<DragState | null>(null);
  const lastClickRef = useRef({ time: 0, col: 0, row: 0, count: 0 });
  const lastHoverRef = useRef(0);
  const lastCaptureRef = useRef(0);
  const handlerRef = useRef<(e: MouseEvent) => void>(() => {});
  const edgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 注意：不要在 render 体里每次 syncChatMetrics —— 仅在事件里更新

  const stopEdge = () => {
    if (edgeTimerRef.current) {
      clearInterval(edgeTimerRef.current);
      edgeTimerRef.current = null;
    }
    if (dragRef.current) dragRef.current.edgeDir = null;
  };

  const ensureEdge = (dir: "up" | "down" | null) => {
    const d = dragRef.current;
    if (!d || d.mode !== "chat" || !d.moved) {
      stopEdge();
      return;
    }
    if (dir === d.edgeDir && edgeTimerRef.current) return;
    stopEdge();
    if (!dir) return;
    d.edgeDir = dir;
    edgeTimerRef.current = setInterval(() => {
      const cur = dragRef.current;
      if (!cur?.moved || cur.mode !== "chat" || cur.edgeDir !== dir) {
        stopEdge();
        return;
      }
      const r = rectRef.current;
      // 到顶/底则停
      const s0 = useStore.getState();
      const off0 = s0.autoFollow ? 0 : Math.min(s0.chatScrollOffset, s0.maxChatScroll);
      if (dir === "up" && off0 >= s0.maxChatScroll) {
        pinChatEndToEdge("up", termSize().cols);
        return;
      }
      if (dir === "down" && off0 <= 0) {
        pinChatEndToEdge("down", termSize().cols);
        return;
      }
      scrollChatLogical(dir, r);
      pinChatEndToEdge(dir, termSize().cols);
      // 不在这里 full+selection 双刷：Ink onRender → scheduleFullPaint，
      // Output.get 内 sync paint + capture。仅当无内容变化时补脏行。
      // scroll 必触发 React 重绘 → onRender full paint 即可。
    }, EDGE_MS);
  };

  handlerRef.current = (e: MouseEvent) => {
    const { rows } = termSize();
    const rect = rectRef.current;

    // motion：轻量路径，不同步 chat metrics、不跑全量 hitTest（除非要 hover）
    if (e.type === "motion") {
      perfInc("mouseMotion");
      if (dragRef.current?.moved) {
        setPointerShape("grabbing");
        return;
      }
      const store = useStore.getState();
      // 滚动中跳过 hover/hitTest，避免每帧扫 DOM
      if (store.scrollActive) return;
      const now = Date.now();
      // 流式时再拉大采样间隔
      const hoverMin = store.streaming ? HOVER_MIN_MS * 2 : HOVER_MIN_MS;
      if (now - lastHoverRef.current < hoverMin) return;
      lastHoverRef.current = now;
      // 真正做 hitTest / 手型更新的采样点 → HUD mse 阶段
      noteUiPhase("mouse");

      // 可点区域始终响应 hover/手型（含流式中）；流式仅在空白处显示 progress
      const hit = hitTestClick(e.col, e.row);
      const id = hit?.id ?? null;
      if (store.hoverId !== id) {
        store.setHoverId(id);
        perfInc("hoverSet");
      }

      if (store.streaming && !hit) {
        setPointerShape("progress");
        return;
      }

      // 可点击优先手型；仅当「不在按钮上且真的在输入文字槽」才用 I 形
      // （避免 inputRect 异常/过大时整屏都是 text 光标）
      const target = hitTest(e.col, e.row, rows, rect);
      const overInput =
        !hit &&
        target.kind === "input" &&
        isPlausibleInputRect(rect.inputRect);
      setPointerShape(
        resolvePointerShape({
          dragging: false,
          clickable: !!hit,
          overInput,
          streaming: store.streaming,
        }),
      );
      return;
    }

    // 非 motion：需要准确区域
    syncChatMetrics(rect);
    const target = hitTest(e.col, e.row, rows, rect);

    if (e.type === "wheelUp" || e.type === "wheelDown") {
      const dir = e.type === "wheelUp" ? "up" : "down";
      const store = useStore.getState();
      const dragging = !!(dragRef.current?.moved && dragRef.current.mode === "chat");

      if (store.fullEditorInitial !== null && !dragging) cbRef.current.onInputScroll?.(dir);
      else if (store.overlay && !dragging) cbRef.current.onOverlayScroll?.(dir);
      else if (store.eventBlockExpanded && !dragging) {
        const hit = hitTestClick(e.col, e.row);
        if (hit) store.scrollSupervisor(dir);
        else cbRef.current.onChatScroll?.(dir);
      } else if (dragging) {
        // 拖选中滚轮：等同边缘方向滚动，保持 end 钉边
        scrollChatLogical(dir, rect);
        pinChatEndToEdge(dir, e.col);
      } else {
        // 普通滚轮：若有 sticky chat 锚点则预热 lineCache（Shift 跨视口）
        if (getStickyAnchor()?.kind === "chat") {
          captureChatVisibleLines({ alsoSticky: true });
        }
        cbRef.current.onChatScroll?.(dir);
        // 滚后 logical 可能变；若仅 sticky 无 active，仍只改 store，Output.get 时 alsoSticky 采集
        if (getStickyAnchor()?.kind === "chat") {
          const s = useStore.getState();
          const offset = s.autoFollow ? 0 : Math.min(s.chatScrollOffset, s.maxChatScroll);
          const { top, bottom } = chatScreenRange(rect);
          setLogicalChatViewMetrics({
            top,
            bottom,
            contentTopY: s.maxChatScroll - offset,
            maxScroll: s.maxChatScroll,
            offset,
          });
        }
      }

      if (dragging) {
        // 等帧；不双刷
      } else if (getActiveSel() && getSelMode() === "chat") {
        // 非拖选时滚轮清 chat 蓝底（保留 sticky 供 Shift）
        clearActiveSel();
        notifySelectionChanged();
      } else if (getActiveSel() && getSelMode() === "input") {
        // 输入选区滚轮不关
      }
      return;
    }

    if (e.type === "down") {
      perfInc("mouseDown");
      process.stdout.write("\x1b[?25l");
      stopEdge();
      const now = Date.now();
      const last = lastClickRef.current;
      const dist = Math.abs(e.col - last.col) + Math.abs(e.row - last.row);
      let clickCount = 1;
      if (now - last.time < DOUBLE_CLICK_MS && dist < DOUBLE_CLICK_DIST) {
        clickCount = Math.min(3, last.count + 1);
      }
      lastClickRef.current = { time: now, col: e.col, row: e.row, count: clickCount };

      const mode = resolveMode(e.row, e.col, rows, rect);
      const snap = snapToCell(e.row, e.col);
      // 按下：可点 pointer > 输入 text > 可拖 grab
      const downHit = hitTestClick(e.col, e.row);
      if (downHit) setPointerShape("pointer");
      else if (mode === "input" && isPlausibleInputRect(rect.inputRect)) {
        setPointerShape("text");
      } else setPointerShape("grab");

      if (e.shift && (mode === "chat" || mode === "global") && clickCount === 1) {
        if (mode === "chat") {
          const ay = screenToAbsY(snap.row, "logical");
          if (ay !== null) {
            startChatSel(ay, snap.col, true);
            // 首帧强制写入视口（含下方将滚出的行）
            captureChatVisibleLines({ alsoSticky: true, fillOnly: false });
            notifySelectionChanged();
            const text = extractSelection();
            if (text.trim()) toastCopy(text);
            dragRef.current = {
              mode: "chat", startCol: snap.col, startRow: snap.row,
              moved: true, clickCount: 1, wordMode: false, edgeDir: null,
            };
          }
        } else {
          startGlobalSel(snap.row, snap.col, true);
          notifySelectionChanged();
          const text = extractSelection();
          if (text.trim()) toastCopy(text);
          dragRef.current = {
            mode: "global", startCol: snap.col, startRow: snap.row,
            moved: true, clickCount: 1, wordMode: false, edgeDir: null,
          };
        }
        return;
      }

      if (mode === "input") {
        // 按下不立刻画选区（零宽蓝块=伪第二光标）；仅记录锚点，拖过阈值再开选
        clearActiveSel();
        selFxClear();
        useStore.getState().setInputTextSel(null);
        notifySelectionChanged();
        if (target.kind === "input") {
          dragRef.current = {
            mode: "input", startCol: snap.col, startRow: snap.row,
            moved: false, clickCount, wordMode: false, edgeDir: null,
          };
        }
        return;
      }

      useStore.getState().setInputTextSel(null);

      if (mode === "chat") {
        const ay = screenToAbsY(snap.row, "logical");
        if (ay === null) return;
        if (clickCount === 2) {
          const word = findWordAt(snap.row, snap.col);
          startChatSel(ay, word.startCol, false);
          updateChatSelEnd(ay, word.endCol);
        } else if (clickCount >= 3) {
          const line = findLineBoundaries(snap.row);
          startChatSel(ay, line.startCol, false);
          updateChatSelEnd(ay, line.endCol);
        } else {
          startChatSel(ay, snap.col, false);
        }
        // 首帧强制写入整视口，保证起点以下/以上即将滚出的行都进 cache
        captureChatVisibleLines({ alsoSticky: true, fillOnly: false });
        if (clickCount >= 2) selFxLive();
        notifySelectionChanged();
        dragRef.current = {
          mode: "chat", startCol: snap.col, startRow: snap.row,
          moved: clickCount >= 2, clickCount, wordMode: clickCount === 2, edgeDir: null,
        };
        return;
      }

      // global
      if (clickCount === 2) {
        const word = findWordAt(snap.row, snap.col);
        startGlobalSel(snap.row, word.startCol, false);
        updateGlobalSelEnd(snap.row, word.endCol);
      } else if (clickCount >= 3) {
        const line = findLineBoundaries(snap.row);
        startGlobalSel(snap.row, line.startCol, false);
        updateGlobalSelEnd(snap.row, line.endCol);
      } else {
        startGlobalSel(snap.row, snap.col, false);
      }
      if (clickCount >= 2) selFxLive();
      notifySelectionChanged();
      dragRef.current = {
        mode: "global", startCol: snap.col, startRow: snap.row,
        moved: clickCount >= 2, clickCount, wordMode: clickCount === 2, edgeDir: null,
      };
      return;
    }

    if (e.type === "drag") {
      const d = dragRef.current;
      if (!d) return;
      if (
        Math.abs(e.row - d.startRow) > DRAG_THRESHOLD ||
        Math.abs(e.col - d.startCol) > DRAG_THRESHOLD * 2
      ) {
        d.moved = true;
        setPointerShape("grabbing");
      }

      const maybeCapture = () => {
        const t = Date.now();
        if (t - lastCaptureRef.current < CAPTURE_MIN_MS) return;
        lastCaptureRef.current = t;
        captureChatVisibleLines({ alsoSticky: true });
      };

      if (d.mode === "input") {
        // 首次越过拖拽阈值：用锚点开启选区，再 extend
        if (d.moved) {
          const cur = hitTest(e.col, e.row, rows, rect);
          const snap = snapToCell(e.row, e.col);
          if (!useStore.getState().inputTextSel) {
            // start 锚点：用 drag 起点的屏幕列/行反推字符列
            const ir = rect.inputRect;
            if (ir) {
              const startLine = Math.max(0, d.startRow - ir.top);
              const startCharCol = Math.max(
                0,
                d.startCol - ir.left - (rect.inputTextColOffset ?? INPUT_TEXT_COL_OFFSET_DEFAULT),
              );
              useStore.getState().dispatchInputSelect(startCharCol, startLine, "start");
              startInputSel(d.startRow, d.startCol);
            }
          }
          if (cur.kind === "input") {
            useStore.getState().dispatchInputSelect(cur.col, cur.line, "extend");
            updateInputSelEnd(snap.row, snap.col);
          } else if (rect.inputRect) {
            const ir = rect.inputRect;
            const clampRow = Math.max(ir.top, Math.min(ir.top + ir.height - 1, e.row));
            const clampCol = Math.max(
              ir.left + (rect.inputTextColOffset ?? INPUT_TEXT_COL_OFFSET_DEFAULT),
              Math.min(ir.left + ir.width - 1, e.col),
            );
            const line = clampRow - ir.top;
            const charCol = Math.max(0, clampCol - ir.left - (rect.inputTextColOffset ?? INPUT_TEXT_COL_OFFSET_DEFAULT));
            useStore.getState().dispatchInputSelect(charCol, line, "extend");
            updateInputSelEnd(clampRow, clampCol);
          }
          selFxLive();
          notifySelectionChanged();
        }
        return;
      }

      if (d.mode === "chat") {
        const m = getChatViewMetrics("logical");
        if (e.row <= m.top + EDGE_ZONE) {
          ensureEdge("up");
          pinChatEndToEdge("up", e.col);
          maybeCapture();
          if (d.moved) selFxLive();
          notifySelectionChanged();
          return;
        }
        // 拖出视口底边（含落到 EventBlock/输入栏）：仍钉在对话区最后一行，
        // 避免选区“卡住半截”且无法选到框内最底几行
        if (e.row >= m.bottom - EDGE_ZONE) {
          ensureEdge("down");
          pinChatEndToEdge("down", e.col);
          maybeCapture();
          if (d.moved) selFxLive();
          notifySelectionChanged();
          return;
        }
        ensureEdge(null);
        const ay = screenToAbsY(e.row, "logical");
        if (ay !== null) {
          if (d.wordMode) {
            const word = findWordAt(e.row, e.col);
            updateChatSelEnd(ay, word.endCol);
          } else {
            updateChatSelEnd(ay, e.col);
          }
        } else if (e.row > m.bottom) {
          // 视口外下方：强制钉底（与 edge 一致）
          pinChatEndToEdge("down", e.col);
        }
        if (d.moved) selFxLive();
        // 拖选中途不每帧 capture（昂贵）；松手再采
        notifySelectionChanged();
        return;
      }

      // global：永不滚对话
      ensureEdge(null);
      const snap = snapToCell(e.row, e.col);
      if (d.wordMode) {
        const word = findWordAt(snap.row, snap.col);
        updateGlobalSelEnd(snap.row, word.endCol);
      } else {
        updateGlobalSelEnd(snap.row, snap.col);
      }
      if (d.moved) selFxLive();
      notifySelectionChanged();
      return;
    }

    if (e.type === "up") {
      const d = dragRef.current;
      dragRef.current = null;
      stopEdge();
      // 松手后按当前位置恢复指针
      {
        const hit = hitTestClick(e.col, e.row);
        const overInput = target.kind === "input";
        setPointerShape(
          resolvePointerShape({
            clickable: !!hit,
            overInput,
            streaming: useStore.getState().streaming && !hit && !overInput,
          }),
        );
      }
      if (!d) return;

      if (d.mode === "input") {
        if (!d.moved) {
          useStore.getState().setInputTextSel(null);
          clearActiveSel();
          selFxClear();
          notifySelectionChanged();
          // 单击：移光标（不留零宽选区）
          if (target.kind === "input") {
            cbRef.current.onInputCursor?.(target.col, target.line);
          }
        } else {
          const ts = useStore.getState().inputTextSel;
          // 零宽/无效选区：清掉，避免蓝块伪光标
          if (!ts || ts.startIdx === ts.endIdx) {
            useStore.getState().setInputTextSel(null);
            clearActiveSel();
            selFxClear();
            notifySelectionChanged();
            if (target.kind === "input") {
              cbRef.current.onInputCursor?.(target.col, target.line);
            }
          } else {
            selFxRelease();
            const text = extractSelection();
            if (text.trim()) toastCopy(text);
            notifySelectionChanged();
          }
        }
        return;
      }

      if (d.clickCount >= 2 || d.moved) {
        // 有效选区松手：彩虹 → 闪白 → 灰底停留
        selFxRelease();
        const finishCopy = () => {
          if (d.mode === "chat") captureChatVisibleLines({ alsoSticky: true });
          const text = extractSelection();
          if (text.trim()) toastCopy(text);
          else {
            clearSelection();
            selFxClear();
          }
          notifySelectionChanged();
        };
        // 边缘滚后 paint 可能尚未与 lastGrid 对齐：等一帧再采，避免丢尾
        if (d.mode === "chat" && isPaintPending()) {
          setTimeout(finishCopy, 48);
        } else {
          finishCopy();
        }
        return;
      }

      // 单击未拖：保留 sticky 锚点，清掉瞬时点选高亮（可选保留一格）
      // 不 clear sticky；清 active 蓝底避免残留
      clearActiveSel();
      selFxClear();
      notifySelectionChanged();

      if (target.kind === "input") {
        cbRef.current.onInputCursor?.(target.col, target.line);
      } else {
        const hit = hitTestClick(e.col, e.row);
        if (hit) hit.onClick();
      }
    }
  };

  useEffect(() => {
    if (!enabled) return;
    enableMouse(process.stdout, { drag: true, anyMotion: true });
    setPointerShape("default");
    const onData = (buf: Buffer) => {
      process.stdout.write("\x1b[?25l");
      for (const ev of parseMouse(buf.toString("latin1"))) {
        handlerRef.current(ev);
      }
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.off("data", onData);
      resetPointerShape();
      disableMouse(process.stdout);
      stopEdge();
    };
  }, [enabled]);
}
