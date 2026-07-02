/** useTerminalSize —— 响应式终端尺寸（底层自适应布局基础） */
import { useState, useEffect } from "react";
import { useStdout } from "ink";

export interface TermSize {
  cols: number;
  rows: number;
  /** 断点：narrow <80, normal 80-120, wide >120 */
  breakpoint: "narrow" | "normal" | "wide";
  /** 是否够宽显示侧栏/HUD */
  showSidebar: boolean;
  showHud: boolean;
}

function classify(cols: number): TermSize["breakpoint"] {
  if (cols < 80) return "narrow";
  if (cols <= 120) return "normal";
  return "wide";
}

/** 实时响应终端 resize，返回尺寸 + 布局断点建议 */
export function useTerminalSize(): TermSize {
  const { stdout } = useStdout();
  const get = (): TermSize => {
    const cols = stdout?.columns ?? 100;
    const rows = stdout?.rows ?? 30;
    const bp = classify(cols);
    return {
      cols,
      rows,
      breakpoint: bp,
      showSidebar: cols >= 70,   // 太窄不显示侧栏
      showHud: cols >= 95,       // 更窄不显示 HUD
    };
  };
  const [size, setSize] = useState<TermSize>(get);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize(get());
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);
  return size;
}
