/**
 * useInputSelection —— 输入框文本选区（框选删除）共享逻辑。
 *
 * InputBar 与 FullScreenEditor 共用：测量屏幕矩形、消费鼠标选区指令、
 * 文本选区→vram 蓝底同步、退格/Ctrl+C 删/复制选区。
 *
 * 选区模式由 useMouseInput 的 down 起点决定（input 内=text 框选删除，外=vram 蓝底复制），
 * 本 hook 只处理 text 模式：读 store.inputSelectCmd 指令 → 算字符索引 → 写 store.inputTextSel。
 */
import { useEffect, useRef } from "react";
import type { DOMElement } from "ink";
import { useStore } from "../state/store.js";
import { useCleanInput } from "./useCleanInput.js";
import { colToIndex, indexToCol } from "../input/hit-test.js";
import { getElementRect } from "../input/click-target.js";
import {
  setSelection as vramSetSelection,
  clearSelection as vramClearSelection,
} from "../render/vram-layer.js";
import { osc52 } from "../input/osc52.js";

export interface InputSelectionOptions {
  boxRef: React.RefObject<DOMElement | null>;
  value: string;
  onChange: (v: string) => void;
  /** TextArea 文字起点相对 inputRect.left 的列偏移（InputBar=4 含" ❯ "，FullScreenEditor=1） */
  colOffset: number;
  /** 设光标位置（forcedCursor 机制，两组件各有实现） */
  setCursor: (pos: [number, number]) => void;
  /** 是否激活（FullScreenEditor 总 true；InputBar = !overlay） */
  active?: boolean;
}

export function useInputSelection(opts: InputSelectionOptions): {
  hasTextSel: boolean;
  inputTextSel: { startIdx: number; endIdx: number } | null;
} {
  const { boxRef, value, onChange, colOffset, setCursor, active = true } = opts;
  const setInputRect = useStore((s) => s.setInputRect);
  const inputTextSel = useStore((s) => s.inputTextSel);
  const setInputTextSel = useStore((s) => s.setInputTextSel);
  const inputSelectCmd = useStore((s) => s.inputSelectCmd);
  // forcedCursor timeout 管理
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setForced = (pos: [number, number]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCursor(pos);
    timerRef.current = setTimeout(() => { timerRef.current = null; }, 50);
  };

  // 测量屏幕矩形并上报（布局/内容变就重测）
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const r = getElementRect(boxRef.current);
    };
    measure();
    const id = setTimeout(measure, 60);
    return () => clearTimeout(id);
  }, [value, active, boxRef, setInputRect]);

  // 鼠标选区指令：start 设起点+移光标，extend 扩展终点
  useEffect(() => {
    if (!active || inputSelectCmd === null) return;
    const { col, line, phase } = inputSelectCmd;
    const idx = colToIndex(value, col, line);
    if (phase === "start") {
      setInputTextSel({ startIdx: idx, endIdx: idx });
      // forcedCursor = TextArea cursorPosition=[line, col]，col 是字符索引（code unit，非视觉列）
      // colToIndex 已把视觉列转成索引，直接用 idx
      setForced([line, idx]);
    } else {
      const cur = useStore.getState().inputTextSel;
      if (cur) setInputTextSel({ startIdx: cur.startIdx, endIdx: idx });
    }
  }, [inputSelectCmd, value, active, setInputTextSel]);

  // 文本选区 → vram 蓝底同步
  useEffect(() => {
    if (!inputTextSel || inputTextSel.startIdx === inputTextSel.endIdx) return;
    const rect = useStore.getState().inputRect;
    if (!rect) return;
    let s = inputTextSel.startIdx, e = inputTextSel.endIdx;
    if (s > e) [s, e] = [e, s];
    const start = indexToCol(value, s);
    const end = indexToCol(value, e);
    vramSetSelection(
      { row: rect.top + start.line, col: rect.left + colOffset + start.col },
      { row: rect.top + end.line, col: rect.left + colOffset + end.col },
    );
  }, [inputTextSel, value, colOffset]);

  const hasTextSel = !!inputTextSel && inputTextSel.startIdx !== inputTextSel.endIdx;

  // 退格/Ctrl+C 处理选区（有选区时抢先于 TextArea，TextArea 用 keybindings 禁掉 Backspace）
  useCleanInput((_input, key) => {
    if (!hasTextSel) return;
    const sel = useStore.getState().inputTextSel;
    if (!sel || sel.startIdx === sel.endIdx) return;
    let s = sel.startIdx, e = sel.endIdx;
    if (s > e) [s, e] = [e, s];
    if (key.backspace || key.delete) {
      const newVal = value.slice(0, s) + value.slice(e);
      onChange(newVal);
      setInputTextSel(null);
      vramClearSelection();
      // 光标移到选区起点：cursorPosition=[line, idx]，line 用 indexToCol 算，col 用 idx（字符索引）
      const pos = indexToCol(newVal, s);
      setForced([pos.line, s]);
      return;
    }
    if (key.ctrl && _input === "\x03") {
      osc52(value.slice(s, e));
      useStore.getState().toastMsg(`已复制 ${e - s} 字 · Cmd+V 粘贴`, "ok");
      setInputTextSel(null);
      vramClearSelection();
    }
  });

  return { hasTextSel, inputTextSel };
}
