/**
 * useTerminalSize —— 响应式终端尺寸（模块单例监听）。
 *
 * 所有消费者共享同一组 process.stdout resize + SIGWINCH + 轮询。
 * resize 时同步 Ink fakeStdout.columns/rows 并 emit('resize')，触发 Yoga 重排。
 */

import { useState, useEffect, type ReactNode } from "react";
import { useStdout } from "ink";
import React from "react";

export interface TermSize {
  cols: number;
  rows: number;
  breakpoint: "narrow" | "normal" | "wide";
  showSidebar: boolean;
  showHud: boolean;
  /** 尺寸变更序号，便于依赖 */
  version: number;
}

function classify(cols: number): TermSize["breakpoint"] {
  if (cols < 80) return "narrow";
  if (cols <= 120) return "normal";
  return "wide";
}

function readRaw(): { cols: number; rows: number } {
  const c = process.stdout.columns;
  const r = process.stdout.rows;
  return {
    cols: typeof c === "number" && c > 0 ? c : 80,
    rows: typeof r === "number" && r > 0 ? r : 24,
  };
}

function buildSize(version: number): TermSize {
  const { cols, rows } = readRaw();
  const bp = classify(cols);
  return {
    cols,
    rows,
    breakpoint: bp,
    showSidebar: cols >= 70,
    showHud: cols >= 95,
    version,
  };
}

type Listener = (s: TermSize) => void;
let globalSize = buildSize(0);
const listeners = new Set<Listener>();
let installed = false;

type InkStdout = {
  columns?: number;
  rows?: number;
  emit?: (e: string, ...args: unknown[]) => boolean;
  setMaxListeners?: (n: number) => void;
};
let inkStdoutRef: InkStdout | null = null;

function notify(next: TermSize) {
  globalSize = next;
  for (const fn of listeners) {
    try { fn(next); } catch { /* ignore */ }
  }
}

/** 从真实 TTY 同步尺寸；可选强制 notify */
export function syncTerminalSize(force = false): TermSize {
  const { cols, rows } = readRaw();
  if (inkStdoutRef) {
    inkStdoutRef.columns = cols;
    inkStdoutRef.rows = rows;
    try {
      inkStdoutRef.emit?.("resize");
    } catch { /* ignore */ }
  }
  if (!force && cols === globalSize.cols && rows === globalSize.rows) {
    return globalSize;
  }
  const next = buildSize(globalSize.version + (force || cols !== globalSize.cols || rows !== globalSize.rows ? 1 : 0));
  if (next.version !== globalSize.version) notify(next);
  return globalSize;
}

function ensureInstalled() {
  if (installed) return;
  installed = true;
  process.stdout.on("resize", () => { syncTerminalSize(false); });
  process.on("SIGWINCH", () => { syncTerminalSize(false); });
  // 兜底：部分终端/进程组丢事件
  setInterval(() => { syncTerminalSize(false); }, 250);
}

/** 注册 Ink 的 fakeStdout，便于同步 columns/rows */
export function setInkStdoutForResize(stdout: InkStdout | null): void {
  inkStdoutRef = stdout;
  if (stdout && typeof stdout.setMaxListeners === "function") {
    stdout.setMaxListeners(64);
  }
  syncTerminalSize(true);
}

/**
 * 挂在 App 根：把 useStdout() 的 fake 流登记进单例。
 * 不提供 Context，子组件直接 useTerminalSize() 订阅单例即可。
 */
export function TerminalSizeProvider({ children }: { children: ReactNode }) {
  const { stdout } = useStdout();
  useEffect(() => {
    ensureInstalled();
    setInkStdoutForResize(stdout as InkStdout);
    return () => {
      // 不清除 inkStdoutRef（App 生命周期内常驻）
    };
  }, [stdout]);
  return React.createElement(React.Fragment, null, children);
}

/** 实时终端尺寸 */
export function useTerminalSize(): TermSize {
  ensureInstalled();
  const [size, setSize] = useState<TermSize>(() => globalSize);
  useEffect(() => {
    const onChange = (s: TermSize) => setSize(s);
    listeners.add(onChange);
    // 挂载时对齐最新
    setSize(globalSize);
    return () => { listeners.delete(onChange); };
  }, []);
  return size;
}
