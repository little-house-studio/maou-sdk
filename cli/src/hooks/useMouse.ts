/** useMouse —— 受控启用鼠标 + 解析事件回调（onEvent 用 ref 保持订阅稳定） */
import { useEffect, useRef } from "react";
import { useStdout } from "ink";
import { enableMouse, disableMouse, parseMouse, type MouseEvent } from "../input/mouse.js";

/**
 * enabled=false 时完全不开鼠标上报 → 终端原生拖选复制可用（优先项）。
 * enabled=true 时只用 1000 模式（点击/释放/滚轮，不含拖动），尽量不破坏选区。
 */
export function useMouse(enabled: boolean, onEvent: (e: MouseEvent) => void): void {
  const { stdout } = useStdout();
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!enabled || !stdout) return;
    enableMouse(stdout);
    const onData = (d: Buffer) => {
      for (const e of parseMouse(d.toString("latin1"))) cb.current(e);
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.off("data", onData);
      disableMouse(stdout);
    };
  }, [enabled, stdout]);
}
