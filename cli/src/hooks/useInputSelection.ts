/**
 * 输入框文本选区：字符索引 + 屏幕高亮（mode=input）。
 * 退格删除 / 复制；与 useMouseInput 的 input 模式配合。
 */

import { useEffect, useRef } from "react";
import type { DOMElement } from "ink";
import { useStore } from "../state/store.js";
import { useCleanInput } from "./useCleanInput.js";
import { colToIndex, indexToCol } from "../input/hit-test.js";

/** 字符索引 → [行, 行内 code point 列]（TextArea cursor 用 code point，非视觉宽） */
function indexToCursorPos(text: string, idx: number): [number, number] {
  const safe = Math.max(0, Math.min(text.length, idx));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < safe; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  const col = [...text.slice(lineStart, safe)].length;
  return [line, col];
}
import { getElementRect } from "../input/click-target.js";
import {
  clearSelection as vramClearSelection,
  notifySelectionChanged,
  setInputTextExtractFn,
} from "../render/vram-layer.js";
import {
  startInputSel,
  updateInputSelEnd,
  clearActiveSel,
  getSelMode,
  setInputBounds,
} from "../render/selection-model.js";
import { copyToClipboard } from "../input/osc52.js";

export interface InputSelectionOptions {
  boxRef: React.RefObject<DOMElement | null>;
  value: string;
  onChange: (v: string) => void;
  colOffset: number;
  setCursor: (pos: [number, number]) => void;
  active?: boolean;
}

export function useInputSelection(opts: InputSelectionOptions): {
  hasTextSel: boolean;
  inputTextSel: { startIdx: number; endIdx: number } | null;
} {
  const { boxRef, value, onChange, colOffset, setCursor, active = true } = opts;
  const setInputRect = useStore((s) => s.setInputRect);
  const setInputDraft = useStore((s) => s.setInputDraft);
  const inputTextSel = useStore((s) => s.inputTextSel);
  const setInputTextSel = useStore((s) => s.setInputTextSel);
  const inputSelectCmd = useStore((s) => s.inputSelectCmd);
  const valueRef = useRef(value);
  valueRef.current = value;

  // 同步草稿 + 注册字符切片提取（松手复制用）
  useEffect(() => {
    setInputDraft(value);
  }, [value, setInputDraft]);

  useEffect(() => {
    setInputTextExtractFn(() => {
      const ts = useStore.getState().inputTextSel;
      const draft = valueRef.current;
      if (!ts || ts.startIdx === ts.endIdx) return null;
      let s = ts.startIdx, e = ts.endIdx;
      if (s > e) [s, e] = [e, s];
      s = Math.max(0, Math.min(draft.length, s));
      e = Math.max(0, Math.min(draft.length, e));
      return draft.slice(s, e);
    });
    return () => setInputTextExtractFn(null);
  }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setForced = (pos: [number, number]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCursor(pos);
    timerRef.current = setTimeout(() => { timerRef.current = null; }, 50);
  };

  const terminalApprovalId = useStore((s) => s.terminalApproval?.id ?? null);

  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const r = getElementRect(boxRef.current);
      // 拒绝异常大矩形（全屏编辑器误写 / yoga 脏数据）→ 否则整屏 I 形光标
      if (r && r.width > 0 && r.height > 0 && r.height <= 10) {
        setInputRect(r);
        setInputBounds({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          textColOffset: colOffset,
        });
      }
    };
    measure();
    const id = setTimeout(measure, 60);
    const id2 = setTimeout(measure, 160); // 审批条弹出后布局下移再测一次
    return () => {
      clearTimeout(id);
      clearTimeout(id2);
    };
  }, [value, active, boxRef, setInputRect, colOffset, terminalApprovalId]);

  // overlay 等 inactive 时清选区，避免蓝底残留、退格删错
  useEffect(() => {
    if (active) return;
    setInputTextSel(null);
    clearActiveSel();
    vramClearSelection();
  }, [active, setInputTextSel]);

  useEffect(() => {
    if (!active || inputSelectCmd === null) return;
    const { col, line, phase } = inputSelectCmd;
    const idx = colToIndex(value, col, line);
    const rect = useStore.getState().inputRect;
    if (phase === "start") {
      // 仅记锚点，不画零宽选区（蓝块=伪光标）
      setInputTextSel({ startIdx: idx, endIdx: idx });
      setForced(indexToCursorPos(value, idx));
      clearActiveSel();
      notifySelectionChanged();
    } else {
      const cur = useStore.getState().inputTextSel;
      if (!cur) {
        setInputTextSel({ startIdx: idx, endIdx: idx });
        return;
      }
      setInputTextSel({ startIdx: cur.startIdx, endIdx: idx });
      // 有宽度才画选区
      if (cur.startIdx !== idx && rect) {
        const a = indexToCol(value, cur.startIdx);
        const b = indexToCol(value, idx);
        startInputSel(rect.top + a.line, rect.left + colOffset + a.col);
        updateInputSelEnd(rect.top + b.line, rect.left + colOffset + b.col);
        notifySelectionChanged();
      } else if (cur.startIdx === idx) {
        clearActiveSel();
        notifySelectionChanged();
      }
    }
  }, [inputSelectCmd, value, active, setInputTextSel, colOffset]);

  // 同步 input 模式屏幕高亮端点（value 变化时）；零宽不画
  useEffect(() => {
    if (!inputTextSel || inputTextSel.startIdx === inputTextSel.endIdx) {
      if (getSelMode() === "input") {
        clearActiveSel();
        notifySelectionChanged();
      }
      return;
    }
    const rect = useStore.getState().inputRect;
    if (!rect) return;
    let s = inputTextSel.startIdx, e = inputTextSel.endIdx;
    if (s > e) [s, e] = [e, s];
    const start = indexToCol(value, s);
    const end = indexToCol(value, e);
    startInputSel(rect.top + start.line, rect.left + colOffset + start.col);
    updateInputSelEnd(rect.top + end.line, rect.left + colOffset + end.col);
    notifySelectionChanged();
  }, [inputTextSel, value, colOffset]);

  const hasTextSel = !!inputTextSel && inputTextSel.startIdx !== inputTextSel.endIdx;

  const collapseSel = (to: "start" | "end") => {
    const sel = useStore.getState().inputTextSel;
    if (!sel) return;
    let s = sel.startIdx, e = sel.endIdx;
    if (s > e) [s, e] = [e, s];
    const idx = to === "start" ? s : e;
    setInputTextSel(null);
    clearActiveSel();
    vramClearSelection();
    setForced(indexToCursorPos(valueRef.current, idx));
  };

  useCleanInput((_input, key) => {
    if (!active || !hasTextSel) return;
    const sel = useStore.getState().inputTextSel;
    if (!sel || sel.startIdx === sel.endIdx) return;
    let s = sel.startIdx, e = sel.endIdx;
    if (s > e) [s, e] = [e, s];
    const v = valueRef.current;

    // Esc：由全局统一取消栈处理（清选区为一层回退）；此处不重复处理

    // 方向键：折叠选区为光标（标准编辑器）
    if (key.leftArrow || key.upArrow) {
      collapseSel("start");
      return;
    }
    if (key.rightArrow || key.downArrow) {
      collapseSel("end");
      return;
    }

    // 任意可打印输入 → 替换选区
    if (
      _input &&
      !key.ctrl &&
      !key.meta &&
      _input !== "\x1b" &&
      !key.return &&
      !key.tab &&
      !key.backspace &&
      !key.delete
    ) {
      const newVal = v.slice(0, s) + _input + v.slice(e);
      onChange(newVal);
      setInputTextSel(null);
      clearActiveSel();
      vramClearSelection();
      setForced(indexToCursorPos(newVal, s + [..._input].length));
      return;
    }

    // Backspace/Delete：由 InputBar 统一处理（词/句/字 + 选区删除），避免双删

    // 复制：Ctrl+C 或 Ctrl+Shift+C 的 char 分支在 app；这里兼容
    if (key.ctrl && (_input === "\x03" || _input === "c" || _input === "C")) {
      copyToClipboard(v.slice(s, e));
      useStore.getState().toastMsg(`已复制 ${e - s} 字`, "ok");
      setInputTextSel(null);
      clearActiveSel();
      vramClearSelection();
    }
  });

  return { hasTextSel, inputTextSel };
}
