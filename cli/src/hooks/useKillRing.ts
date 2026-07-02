/**
 * useKillRing —— Emacs 风格剪贴板历史（Ctrl+Y 粘贴最近，Alt+Y 循环历史）。
 * 阶段 7 基础：内存环形缓冲，最多 10 条。
 */

import { useRef, useCallback } from "react";

const MAX_KILL = 10;

export function useKillRing() {
  const ring = useRef<string[]>([]);
  const yankPos = useRef<number>(-1);

  const kill = useCallback((text: string) => {
    if (!text) return;
    ring.current = [text, ...ring.current.slice(0, MAX_KILL - 1)];
    yankPos.current = 0;
  }, []);

  const yank = useCallback((): string | null => {
    if (ring.current.length === 0) return null;
    return ring.current[0] ?? null;
  }, []);

  const yankPop = useCallback((): string | null => {
    if (ring.current.length === 0) return null;
    yankPos.current = (yankPos.current + 1) % ring.current.length;
    return ring.current[yankPos.current] ?? null;
  }, []);

  return { kill, yank, yankPop };
}
