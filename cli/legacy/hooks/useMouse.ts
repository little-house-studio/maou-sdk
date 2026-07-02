/** useMouse —— 受控启用鼠标 + 解析事件回调（onEvent 用 ref 保持订阅稳定） */
import { useEffect, useRef } from "react";
import { useStdout } from "ink";
import { enableMouse, disableMouse, parseMouse, type MouseEvent } from "../input/mouse.js";

/**
 * enabled=false 时完全不开鼠标上报 → 终端原生拖选复制可用。
 * enabled=true 时用 1002 拖动模式（点击/释放/拖动/滚轮），支持自绘选区；
 * 想走终端原生选择就按 Shift(xterm)/Option(iTerm2) 拖动绕过。
 */
export function useMouse(enabled: boolean, onEvent: (e: MouseEvent) => void, opts: { drag?: boolean } = {}): void {
  const { stdout } = useStdout();
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const drag = opts.drag ?? true;
  useEffect(() => {
    if (!enabled || !stdout) return;
    enableMouse(stdout, { drag });
    const onData = (d: Buffer) => {
      for (const e of parseMouse(d.toString("latin1"))) cb.current(e);
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.off("data", onData);
      disableMouse(stdout);
    };
  }, [enabled, stdout, drag]);
}
