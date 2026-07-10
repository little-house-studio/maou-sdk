/**
 * useMouseInput —— ?1003 全追踪 + vram-layer 选区 + OSC52 复制 + 双击选词。
 *
 * 始终开 ?1003?1006（全追踪），收 hover/motion/click/wheel。
 *   - 单击 → 点击命中可点击元素或 InputBar 移光标
 *   - 双击 → 选词（findWordAt），松手 OSC52 复制
 *   - 三击 → 选行（findLineBoundaries），松手 OSC52 复制
 *   - 双击后拖拽 → 按词扩展选区
 *   - 普通拖拽 → 按字符选区，松手 OSC52 复制
 *   - wheel → 对话区滚动
 *   - hover 反色已移除（点击位置会残留伪光标，违背"只有输入框有光标"）
 */

import { useEffect, useRef } from "react";
import { useStdout } from "ink";
import { enableMouse, disableMouse, parseMouse, type MouseEvent } from "../input/mouse.js";
import { hitTest, type LayoutRect } from "../input/hit-test.js";
import { hitTestClick } from "../input/click-target.js";
import { useStore } from "../state/store.js";
import {
  setSelection, clearSelection, extractSelection, renderWithSelection,
  findWordAt, findLineBoundaries,
} from "../render/vram-layer.js";
import { osc52 } from "../input/osc52.js";

interface DragState {
  startCol: number;
  startRow: number;
  moved: boolean;
  clickCount: number;   // 1=单击 2=双击 3=三击
  wordMode: boolean;    // 双击后拖拽：按词扩展
  wordStart?: { row: number; col: number };  // 双击选词的起点（词边界）
  wordEnd?: { row: number; col: number };    // 双击选词的终点（词边界）
  dragMode: "text" | "vram";  // down 起点决定：input 内=text（选区删除），外=vram（蓝底复制）
  startTarget?: { kind: "input"; col: number; line: number } | { kind: "other" };
}

const DRAG_THRESHOLD = 1; // 网页感：轻微移动即进入拖选
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DIST = 3;
/** 拖选时靠近上下文窗口上下边缘自动滚一行 */
const EDGE_SCROLL_PX = 1;

export interface MouseCallbacks {
  onInputCursor?: (charIndex: number, line: number) => void;
  onChatScroll?: (dir: "up" | "down") => void;
  onInputScroll?: (dir: "up" | "down") => void;
  onOverlayScroll?: (dir: "up" | "down") => void;  // overlay 开时滚轮滚动菜单项
}

export function useMouseInput(
  enabled: boolean,
  rect: LayoutRect,
  cb: MouseCallbacks,
): void {
  const { stdout } = useStdout();
  const cbRef = useRef(cb);
  cbRef.current = cb;
  // rect 用 ref：effect 不因布局变化重绑 stdin，但 hitTest 始终用最新矩形
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const dragRef = useRef<DragState | null>(null);
  const lastClickRef = useRef<{ time: number; col: number; row: number; count: number }>({
    time: 0, col: 0, row: 0, count: 0,
  });
  const lastHoverRef = useRef(0);

  useEffect(() => {
    if (!enabled || !stdout) return;
    enableMouse(stdout, { drag: true, anyMotion: true });

    let lastRender = 0;
    const onData = (buf: Buffer) => {
      process.stdout.write("\x1b[?25l");
      const events = parseMouse(buf.toString("latin1"));
      for (const e of events) {
        handleEvent(e);
      }
      const now = Date.now();
      // 流式时放宽 vram 重绘间隔，把事件循环让给键盘/滚轮
      const minGap = useStore.getState().streaming ? 80 : 30;
      if (now - lastRender > minGap) {
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 24;
        renderWithSelection(cols, rows);
        lastRender = now;
      }
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.off("data", onData);
      disableMouse(stdout);
    };
  }, [enabled, stdout]);

  const handleEvent = (e: MouseEvent) => {
    const rows = stdout?.rows ?? 30;
    const rect = rectRef.current;
    const target = hitTest(e.col, e.row, rows, rect);

    if (e.type === "wheelUp" || e.type === "wheelDown") {
      const dir = e.type === "wheelUp" ? "up" : "down";
      const store = useStore.getState();
      // 拖选中滚轮：滚动上下文窗口，不中断选区（网页感）
      const dragging = dragRef.current?.moved && dragRef.current.dragMode === "vram";
      if (store.fullEditorInitial !== null && !dragging) cbRef.current.onInputScroll?.(dir);
      else if (store.overlay && !dragging) cbRef.current.onOverlayScroll?.(dir);
      else if (store.eventBlockExpanded && !dragging) {
        const hit = hitTestClick(e.col, e.row);
        if (hit) store.scrollSupervisor(dir);
        else cbRef.current.onChatScroll?.(dir);
      } else {
        cbRef.current.onChatScroll?.(dir);
      }
      // 拖选中滚轮后立刻重绘蓝底
      if (dragging) {
        const cols = process.stdout.columns || 80;
        const r = process.stdout.rows || 24;
        renderWithSelection(cols, r);
      }
      return;
    }

    // hover motion：流式时跳过（?1003 狂刷 motion 会饿死键盘与滚轮）
    if (e.type === "motion") {
      if (useStore.getState().streaming) return;
      const now = Date.now();
      if (now - lastHoverRef.current < 30) return;
      lastHoverRef.current = now;
      const hit = hitTestClick(e.col, e.row);
      const store = useStore.getState();
      const newId = hit?.id ?? null;
      if (store.hoverId !== newId) store.setHoverId(newId);
      return;
    }

    if (e.type === "down") {
      process.stdout.write("\x1b[?25l");
      // 双击/三击检测
      const now = Date.now();
      const last = lastClickRef.current;
      const dist = Math.abs(e.col - last.col) + Math.abs(e.row - last.row);
      let clickCount = 1;
      if (now - last.time < DOUBLE_CLICK_MS && dist < DOUBLE_CLICK_DIST) {
        clickCount = last.count + 1;
      }
      lastClickRef.current = { time: now, col: e.col, row: e.row, count: clickCount };

      // down 起点决定选区模式：input 内 = text（框选删除），外 = vram（蓝底复制）
      const target = hitTest(e.col, e.row, rows, rect);
      const inInput = target.kind === "input";

      if (inInput && clickCount === 1) {
        // 输入框内单击：移光标 + 开始文本选区（dragMode=text）
        // 只走 dispatchInputSelect（它内部设 forcedCursor + textSel），不调 onInputCursor 避免双重设光标
        useStore.getState().dispatchInputSelect(target.col, target.line, "start");
        dragRef.current = {
          startCol: e.col, startRow: e.row, moved: false,
          clickCount: 1, wordMode: false, dragMode: "text",
          startTarget: { kind: "input", col: target.col, line: target.line },
        };
        return;
      }

      // 非输入框 或 双击/三击：走 vram 蓝底复制模式
      if (clickCount === 2) {
        // 双击：选词
        const word = findWordAt(e.row, e.col);
        const anchor = { row: e.row, col: word.startCol };
        const focus = { row: e.row, col: word.endCol };
        setSelection(anchor, focus);
        dragRef.current = {
          startCol: e.col, startRow: e.row, moved: false,
          clickCount: 2, wordMode: true, dragMode: "vram",
          wordStart: anchor, wordEnd: focus,
        };
      } else if (clickCount >= 3) {
        // 三击：选行
        const line = findLineBoundaries(e.row);
        const anchor = { row: e.row, col: line.startCol };
        const focus = { row: e.row, col: line.endCol };
        setSelection(anchor, focus);
        dragRef.current = {
          startCol: e.col, startRow: e.row, moved: false,
          clickCount: 3, wordMode: false, dragMode: "vram",
          wordStart: anchor, wordEnd: focus,
        };
      } else {
        // 单击：清选区，开始正常拖拽
        clearSelection();
        dragRef.current = {
          startCol: e.col, startRow: e.row, moved: false,
          clickCount: 1, wordMode: false, dragMode: "vram",
        };
      }
      return;
    }

    if (e.type === "drag") {
      const d = dragRef.current;
      if (!d) return;
      const movedRows = Math.abs(e.row - d.startRow);
      const movedCols = Math.abs(e.col - d.startCol);
      const hasMoved = movedRows > DRAG_THRESHOLD || movedCols > DRAG_THRESHOLD * 2;

      // text 模式（input 内 down）：扩展文本选区，不碰 vram 蓝底（InputBar 自己同步）
      if (d.dragMode === "text" && d.startTarget?.kind === "input") {
        const t = d.startTarget;
        // 把当前鼠标坐标映射到 input 内的 col/line（鼠标可能已移出 input，clamp 到 input 行）
        const cur = hitTest(e.col, e.row, rows, rect);
        let col: number, line: number;
        if (cur.kind === "input") { col = cur.col; line = cur.line; }
        else {
          // 移出 input：按起始行 + 横向 clamp（拖到 input 左/右外 → 选到行首/行尾方向）
          col = Math.max(0, e.col - (rect.inputRect?.left ?? 0) - 4);
          line = t.line;
        }
        if (hasMoved || !d.moved) {
          d.moved = true;
          useStore.getState().dispatchInputSelect(col, line, "extend");
        }
        return;
      }

      // vram 模式：上下文窗口拖选（网页感蓝底）
      if (d.clickCount === 2 && d.wordMode) {
        if (hasMoved || !d.moved) {
          d.moved = true;
          const word = findWordAt(e.row, e.col);
          const curWordStart = { row: e.row, col: word.startCol };
          const curWordEnd = { row: e.row, col: word.endCol };
          if (e.col >= d.startCol) {
            setSelection(d.wordStart!, curWordEnd);
          } else {
            setSelection(curWordStart, d.wordEnd!);
          }
        }
      } else if (d.clickCount === 1 || d.clickCount >= 3) {
        // 单击/三击后拖：按字符扩展选区
        if (!d.moved && hasMoved) {
          d.moved = true;
          setSelection({ row: d.startRow, col: d.startCol }, { row: e.row, col: e.col });
        } else if (d.moved) {
          setSelection({ row: d.startRow, col: d.startCol }, { row: e.row, col: e.col });
        }
      }

      // 边缘自动滚动：拖到上下文窗口顶/底附近时滚动 1 行（网页 select + scroll）
      if (d.moved && d.dragMode === "vram") {
        const chatTop = rect.chatTop ?? 2;
        const chatBottom = rect.chatBottom ?? (rows - 4);
        if (e.row <= chatTop + EDGE_SCROLL_PX) {
          useStore.getState().scrollChat("up");
        } else if (e.row >= chatBottom - EDGE_SCROLL_PX) {
          useStore.getState().scrollChat("down");
        }
        // 拖选时即时刷新蓝底（不节流）
        const cols = process.stdout.columns || 80;
        renderWithSelection(cols, rows);
      }
      return;
    }

    if (e.type === "up") {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;

      // text 模式（input 内）：保留文本选区待退格删除，不 OSC52 复制
      if (d.dragMode === "text") {
        // 若没拖动（纯点击），textSel 是空选区（start==end），清掉
        if (!d.moved) {
          useStore.getState().setInputTextSel(null);
        }
        return;
      }

      // vram 模式：双击/三击/拖拽结束 → OSC52 复制
      if (d.clickCount >= 2 || d.moved) {
        const text = extractSelection();
        if (text && text.trim()) {
          osc52(text);
          if (d.clickCount >= 2) {
            // 双击/三击选词也复制，但不 toast（避免干扰）
          } else {
            useStore.getState().toastMsg(`已复制 ${text.length} 字 · Cmd+V 粘贴`, "ok");
          }
        }
        return;
      }

      // vram 单击（无拖拽）：点击命中
      if (target.kind === "input") {
        cbRef.current.onInputCursor?.(target.col, target.line);
      } else {
        const hit = hitTestClick(e.col, e.row);
        if (hit) hit.onClick();
      }
    }
  };
}
