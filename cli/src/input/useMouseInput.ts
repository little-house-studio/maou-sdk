/**
 * useMouseInput —— 受控鼠标 + 命中分发。
 *
 * SGR 1000 模式（down/up/wheel，不上报 drag）。
 *   - down + up（无显著移动）→ 点击，命中可点击元素或 InputBar 移光标
 *   - 滚轮 → 对话区滚动
 * 文字选择走终端原生：Shift+拖拽绕过 SGR，终端画高亮 + 复制剪贴板（可靠）。
 *
 * 注：曾尝试 1002 模式 + 自绘选区 + OSC52，但 Ink 不暴露渲染后字符位置，
 * 无法画选区高亮也无可靠文本提取，不可行。原生选择是终端协议唯一可靠方案。
 */

import { useEffect, useRef } from "react";
import { useStdout } from "ink";
import { enableMouse, disableMouse, parseMouse, type MouseEvent } from "../input/mouse.js";
import { hitTest, type LayoutRect } from "../input/hit-test.js";
import { hitTestClick } from "../input/click-target.js";
import { useStore } from "../state/store.js";

const MOUSE_DEBUG = process.env.MAOU_MOUSE_DEBUG === "1";

interface DragState {
  startCol: number;
  startRow: number;
}

/** 移动超过这个阈值视为拖拽（不触发点击） */
const DRAG_THRESHOLD = 2;

export interface MouseCallbacks {
  onInputCursor?: (charIndex: number) => void;
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
  // 首次鼠标点击提示一次文字选择方式（终端原生选择，Ink 无法自绘反色）
  const hintShownRef = useRef(false);

  useEffect(() => {
    if (!enabled || !stdout) return;
    // 1000 模式：down/up/wheel。Shift+拖拽走终端原生选择（高亮+复制）。
    enableMouse(stdout, { drag: false });
    if (MOUSE_DEBUG) useStore.getState().toastMsg(`mouse on cols=${stdout.columns} rows=${stdout.rows}`, "info");

    const onData = (buf: Buffer) => {
      const s = buf.toString("latin1");
      const events = parseMouse(s);
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
      // 首次点击提示文字选择方式（Terminal.app 下 1000 模式与直接拖拽互斥）
      if (!hintShownRef.current) {
        hintShownRef.current = true;
        store.toastMsg("选字：Ctrl+K → 切换鼠标捕获关闭后拖拽", "info");
      }
      dragRef.current = { startCol: e.col, startRow: e.row };
      return;
    }
    if (e.type === "up") {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;

      // 移动超过阈值视为拖拽（不触发点击，让终端原生选择处理）
      const movedRows = Math.abs(e.row - d.startRow);
      const movedCols = Math.abs(e.col - d.startCol);
      if (movedRows > DRAG_THRESHOLD || movedCols > DRAG_THRESHOLD * 2) return;

      // 短按：点击命中
      if (MOUSE_DEBUG) useStore.getState().toastMsg(`click ${e.col},${e.row}→${target.kind}`, "info");
      if (target.kind === "input") {
        cbRef.current.onInputCursor?.(target.col);
      } else {
        const hit = hitTestClick(e.col, e.row);
        if (hit) hit.onClick();
      }
    }
  };
}
