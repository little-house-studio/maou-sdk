/**
 * 文档正文撤销 / 重做
 * - 立即记录：任务勾选、表格、画布失焦提交等
 * - 防抖记录：源码编辑连续输入
 */

import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 80;
const DEBOUNCE_MS = 450;

export function useDocHistory(initial = "") {
  const [content, setContentState] = useState(initial);
  const contentRef = useRef(initial);
  const stackRef = useRef<string[]>([initial]);
  const indexRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, bump] = useState(0);

  const refreshFlags = () => bump((n) => n + 1);

  const pushSnapshot = (value: string) => {
    const stack = stackRef.current;
    const idx = indexRef.current;
    if (stack[idx] === value) return;
    const next = stack.slice(0, idx + 1);
    next.push(value);
    while (next.length > MAX_HISTORY) next.shift();
    stackRef.current = next;
    indexRef.current = next.length - 1;
  };

  const reset = useCallback((text: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    stackRef.current = [text];
    indexRef.current = 0;
    contentRef.current = text;
    setContentState(text);
    refreshFlags();
  }, []);

  /** 更新正文并立刻写入历史 */
  const setContent = useCallback(
    (next: string | ((prev: string) => string)) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setContentState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        if (value === prev) return prev;
        pushSnapshot(value);
        contentRef.current = value;
        queueMicrotask(refreshFlags);
        return value;
      });
    },
    [],
  );

  /** 连续输入：先改 UI，防抖后再记历史 */
  const setContentLive = useCallback((value: string) => {
    contentRef.current = value;
    setContentState(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      pushSnapshot(value);
      refreshFlags();
    }, DEBOUNCE_MS);
  }, []);

  const flushDebounce = () => {
    if (!debounceRef.current) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = null;
    pushSnapshot(contentRef.current);
  };

  const undo = useCallback(() => {
    flushDebounce();
    if (indexRef.current <= 0) {
      refreshFlags();
      return false;
    }
    indexRef.current -= 1;
    const v = stackRef.current[indexRef.current]!;
    contentRef.current = v;
    setContentState(v);
    refreshFlags();
    return true;
  }, []);

  const redo = useCallback(() => {
    flushDebounce();
    if (indexRef.current >= stackRef.current.length - 1) {
      refreshFlags();
      return false;
    }
    indexRef.current += 1;
    const v = stackRef.current[indexRef.current]!;
    contentRef.current = v;
    setContentState(v);
    refreshFlags();
    return true;
  }, []);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < stackRef.current.length - 1;

  return {
    content,
    setContent,
    setContentLive,
    reset,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
