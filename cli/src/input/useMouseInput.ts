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

const DRAG_THRESHOLD = 2;
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DIST = 3;

export interface MouseCallbacks {
  onInputCursor?: (charIndex: number, line: number) => void;
  onChatScroll?: (dir: "up" | "down") => void;
  onInputScroll?: (dir: "up" | "down") => void;
}

export function useMouseInput(
  enabled: boolean,
  rect: LayoutRect,
  cb: MouseCallbacks,
): void {
  const { stdout } = useStdout();
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const dragRef = useRef<DragState | null>(null);
  const lastClickRef = useRef<{ time: number; col: number; row: number; count: number }>({
    time: 0, col: 0, row: 0, count: 0,
  });

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
      if (now - lastRender > 30) {
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
    const target = hitTest(e.col, e.row, rows, rect);

    if (e.type === "wheelUp" || e.type === "wheelDown") {
      const dir = e.type === "wheelUp" ? "up" : "down";
      const store = useStore.getState();
      if (store.fullEditorInitial !== null) cbRef.current.onInputScroll?.(dir);
      else cbRef.current.onChatScroll?.(dir);
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

      // vram 模式：现有蓝底选区逻辑
      if (d.clickCount === 2 && d.wordMode) {
        // 双击后拖拽：按词扩展选区
        if (hasMoved || !d.moved) {
          d.moved = true;
          // 找当前拖拽位置的词边界
          const word = findWordAt(e.row, e.col);
          const curWordStart = { row: e.row, col: word.startCol };
          const curWordEnd = { row: e.row, col: word.endCol };
          // 选区从原始词起点到当前词终点（向右拖）或当前词起点到原始词终点（向左拖）
          if (e.col >= d.startCol) {
            // 向右拖：anchor=原始词起点, focus=当前词终点
            setSelection(d.wordStart!, curWordEnd);
          } else {
            // 向左拖：anchor=当前词起点, focus=原始词终点
            setSelection(curWordStart, d.wordEnd!);
          }
        }
      } else if (d.clickCount === 1) {
        // 普通拖拽：按字符选区
        if (!d.moved && hasMoved) {
          d.moved = true;
          setSelection({ row: d.startRow, col: d.startCol }, { row: e.row, col: e.col });
        } else if (d.moved) {
          setSelection({ row: d.startRow, col: d.startCol }, { row: e.row, col: e.col });
        }
        // 单击未拖动时不设 hover：hover 反色块会在点击位置残留成"伪光标"，
        // 违背"只有输入框聚焦才有光标"的规则。hover 高亮改由各组件自管（后续）。
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
