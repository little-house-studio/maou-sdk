/**
 * useMouseInput —— 受控鼠标 + 命中分发 + 拖选 OSC52。
 *
 * 默认 enabled=false（保留终端原生拖选复制）。
 * enabled=true 时开 1002 拖动模式：点击移 InputBar 光标、滚轮滚动 ChatPage、
 * 拖选自绘选区、松手 OSC52 复制。
 *
 * 复用 input/mouse.ts SGR-1006 解析（已完备）。
 */

import { useEffect, useRef, useState } from "react";
import { useStdout } from "ink";
import { enableMouse, disableMouse, parseMouse, type MouseEvent } from "../input/mouse.js";
import { osc52 } from "../input/osc52.js";
import { hitTest, colToIndex, type LayoutRect } from "../input/hit-test.js";
import { useStore } from "../state/store.js";

interface DragState {
  startCol: number;
  startRow: number;
  text: string;
}

export interface MouseCallbacks {
  onInputCursor?: (charIndex: number) => void;  // 点击 InputBar 移光标
  onChatScroll?: (dir: "up" | "down") => void;  // 滚轮滚动对话区
  onSelectText?: (text: string) => void;        // 拖选松手复制
  onInputScroll?: (dir: "up" | "down") => void; // 滚轮滚动 InputBar 内容（>viewportLines 时）
}

export function useMouseInput(
  enabled: boolean,
  rect: LayoutRect,
  cb: MouseCallbacks,
): void {
  const { stdout } = useStdout();
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!enabled || !stdout) return;
    enableMouse(stdout, { drag: true });

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
      // 按光标位置分流：鼠标在 InputBar 行内且内容超 viewportLines(4) → 滚 InputBar；
      // 否则滚对话区。全屏编辑器开时 target 不会命中 input（rect.inputRowFromBottom=0）。
      if (target.kind === "input" && store.inputLineCount > 4) {
        cbRef.current.onInputScroll?.(dir);
      } else {
        cbRef.current.onChatScroll?.(dir);
      }
      return;
    }
    if (e.type === "down") {
      // 点击 InputBar 移光标
      if (target.kind === "input") {
        // 需要 InputBar 的当前 value——通过回调拿不到，用 store 暂存
        // 实际光标移动由 InputBar 监听 store.mouseCol 实现（简化）
        cbRef.current.onInputCursor?.(target.col);
      }
      // 开始拖选（记录起点）
      dragRef.current = { startCol: e.col, startRow: e.row, text: "" };
      setDrag(dragRef.current);
    }
    if (e.type === "up") {
      // 松手：若有拖选文本，OSC52 复制
      if (dragRef.current && dragRef.current.text) {
        cbRef.current.onSelectText?.(dragRef.current.text);
        osc52(dragRef.current.text);
      }
      dragRef.current = null;
      setDrag(null);
    }
  };
}
