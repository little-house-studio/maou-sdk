/**
 * useMouseInput —— ?1003 全追踪 + 自画选区 + OSC52 复制。
 *
 * 始终开 ?1003?1006（全追踪），收 hover/motion/click/wheel。
 *   - down + up（无显著移动）→ 点击，命中可点击元素或 InputBar 移光标
 *   - down + motion（移动超阈值）→ 拖拽选区，更新 store.selection，松手 OSC52 复制
 *   - wheel → 对话区滚动
 *   - hover（无按键 motion）→ 命中可点击元素设 hoverId
 *
 * 选区文本由 screenBuffer 提供（SelectableText 渲染时登记）。
 */

import { useEffect, useRef } from "react";
import { useStdout } from "ink";
import { enableMouse, disableMouse, parseMouse, type MouseEvent } from "../input/mouse.js";
import { hitTest, type LayoutRect } from "../input/hit-test.js";
import { hitTestClick } from "../input/click-target.js";
import { useStore } from "../state/store.js";
import { extractSelection } from "../input/screen-buffer.js";
import { osc52 } from "../input/osc52.js";

const MOUSE_DEBUG = process.env.MAOU_MOUSE_DEBUG === "1";

interface DragState {
  startCol: number;
  startRow: number;
  moved: boolean; // 是否已超过拖拽阈值
}

/** 移动超过这个阈值视为拖拽（不触发点击） */
const DRAG_THRESHOLD = 2;

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

  useEffect(() => {
    if (!enabled || !stdout) return;
    // ?1003 全追踪：点击/拖动/hover/wheel 全收。SGR 编码。
    enableMouse(stdout, { drag: true, anyMotion: true });

    const onData = (buf: Buffer) => {
      const events = parseMouse(buf.toString("latin1"));
      for (const e of events) {
        handleEvent(e);
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
    const store = useStore.getState();

    if (e.type === "wheelUp" || e.type === "wheelDown") {
      const dir = e.type === "wheelUp" ? "up" : "down";
      if (store.fullEditorInitial !== null) {
        cbRef.current.onInputScroll?.(dir);
      } else {
        cbRef.current.onChatScroll?.(dir);
      }
      return;
    }
    if (e.type === "down") {
      dragRef.current = { startCol: e.col, startRow: e.row, moved: false };
      return;
    }
    if (e.type === "drag") {
      // 按住左键移动（?1003 上报 drag）
      const d = dragRef.current;
      if (!d) return;
      const movedRows = Math.abs(e.row - d.startRow);
      const movedCols = Math.abs(e.col - d.startCol);
      if (!d.moved && (movedRows > DRAG_THRESHOLD || movedCols > DRAG_THRESHOLD * 2)) {
        d.moved = true;
        // 开始选区
        store.setSelection({ start: { row: d.startRow, col: d.startCol }, end: { row: e.row, col: e.col } });
      } else if (d.moved) {
        // 持续更新选区终点
        store.setSelection({ start: { row: d.startRow, col: d.startCol }, end: { row: e.row, col: e.col } });
      }
      return;
    }
    if (e.type === "up") {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.moved) {
        // 拖拽结束 → 提取选区文本 → OSC52 复制
        const sel = store.selection;
        if (sel) {
          const text = extractSelection(sel.start, sel.end);
          if (text && text.trim()) {
            osc52(text);
            store.toastMsg(`已复制 ${text.length} 字`, "ok");
          }
          store.setSelection(null);
        }
        return;
      }
      // 短按：点击命中
      if (MOUSE_DEBUG) useStore.getState().toastMsg(`click ${e.col},${e.row}→${target.kind}`, "info");
      if (target.kind === "input") {
        cbRef.current.onInputCursor?.(target.col, target.line);
      } else {
        const hit = hitTestClick(e.col, e.row);
        if (hit) hit.onClick();
      }
    }
  };
}
