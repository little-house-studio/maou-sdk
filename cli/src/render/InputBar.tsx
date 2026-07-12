/**
 * InputBar —— 多行输入框（react-ink-textarea）。
 *
 * 光标策略（重要）：
 *   react-ink-textarea 在传入 cursorPosition 时为「完全受控」——
 *   内部 setCursor 不会更新 internalCursor，显示位置只听 controlledPosition。
 *   因此父组件必须始终持有 [line,col]，并在 onCursorChange 里同步；
 *   打字时库会 onCursorAttempt → onCursorChange，我们 setCursorPos 即可跟字。
 *   禁止「临时 forced + 超时清空」：清空后 internal 是旧值，光标会卡在旧位置。
 */

import React, { useRef, useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { TextArea, type TextAreaHandle } from "react-ink-textarea";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useImeCursor } from "../hooks/useImeCursor.js";
import { useInputSelection } from "../hooks/useInputSelection.js";
import { colToIndex } from "../input/hit-test.js";
import {
  cursorToIndex,
  indexToCursor,
  completionInsertSuffix,
  applyCompletion,
  complete,
} from "../overlay/Completer.js";
import {
  clearSelection as vramClearSelection,
} from "../render/vram-layer.js";
import { clearActiveSel } from "../render/selection-model.js";

interface Props {
  value: string;
  onSubmit: (text: string) => void;
  onChange: (v: string) => void;
  onFullEditor: (initial: string) => void;
}

function scrubInput(v: string): string {
  return v
    .replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, "")
    .replace(/\[<\d+;\d+;\d+[Mm]/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1bO[A-Z]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export function InputBar({ value, onSubmit, onChange, onFullEditor }: Props) {
  const t = useTheme();
  const streaming = useStore((s) => s.streaming);
  const pendingCount = useStore((s) => s.pendingMessages.length);
  const term = useTerminalSize();
  const mouseCursorCol = useStore((s) => s.mouseCursorCol);
  const setMouseCursorCol = useStore((s) => s.setMouseCursorCol);
  const mouseCursorLine = useStore((s) => s.mouseCursorLine);
  const setMouseCursorLine = useStore((s) => s.setMouseCursorLine);
  const setInputLineCount = useStore((s) => s.setInputLineCount);
  const inputCursorShift = useStore((s) => s.inputCursorShift);
  const completion = useStore((s) => s.completion);
  const overlay = useStore((s) => s.overlay);
  const showComp = completion !== null && (completion.items?.length ?? 0) > 0;

  const taRef = useRef<TextAreaHandle>(null);
  const boxRef = useRef<DOMElement | null>(null);

  /**
   * 始终受控的光标 [line, col]（code point 列）。
   * 与 react-ink-textarea 契约：只要传了 cursorPosition，父组件必须跟上每一次 onCursorChange。
   */
  const [cursorPos, setCursorPos] = useState<[number, number]>([0, 0]);
  const cursorPosRef = useRef<[number, number]>([0, 0]);
  const cursorIndexRef = useRef(0);

  const applyingHistoryRef = useRef(false);
  const applyingCompletionRef = useRef(false);
  const savedInputRef = useRef<string | null>(null);
  const acceptingRef = useRef(false);
  /** 最新文本（onCursorChange 时 props.value 可能还是上一帧） */
  const valueRef = useRef(value);
  valueRef.current = value;

  /** 写入光标（state + ref + index），供补全/鼠标/历史共用 */
  const placeCursor = (text: string, pos: [number, number]) => {
    cursorPosRef.current = pos;
    setCursorPos(pos);
    cursorIndexRef.current = cursorToIndex(text, pos[0], pos[1]);
  };

  const placeCursorAtIndex = (text: string, index: number) => {
    const pos = indexToCursor(text, index);
    cursorIndexRef.current = Math.max(0, Math.min(text.length, index));
    cursorPosRef.current = pos;
    setCursorPos(pos);
  };

  const refreshCompletion = (text: string, cursorIndex?: number) => {
    if (applyingHistoryRef.current || applyingCompletionRef.current) return;
    const idx = cursorIndex ?? cursorIndexRef.current;
    useStore.getState().updateCompletion(text, idx);
  };

  const applyHistoryText = (text: string) => {
    applyingHistoryRef.current = true;
    onChange(text);
    useStore.getState().closeCompletion();
    placeCursorAtIndex(text, text.length);
    queueMicrotask(() => {
      applyingHistoryRef.current = false;
    });
  };

  const clearInputChrome = () => {
    useStore.getState().closeCompletion();
    useStore.getState().resetHistoryIndex();
    useStore.getState().setInputTextSel(null);
    clearActiveSel();
    vramClearSelection();
    savedInputRef.current = null;
  };

  useEffect(() => {
    setInputLineCount(Math.max(1, value.split("\n").length));
  }, [value, setInputLineCount]);

  useEffect(() => {
    if (overlay) {
      useStore.getState().setInputTextSel(null);
      clearActiveSel();
      vramClearSelection();
    }
  }, [overlay]);

  // 鼠标点击：视觉列 → 字符索引 → [line, col]
  useEffect(() => {
    if (mouseCursorCol === null) return;
    if (overlay) {
      setMouseCursorCol(null);
      setMouseCursorLine(null);
      return;
    }
    const line = mouseCursorLine ?? 0;
    const idx = colToIndex(value, mouseCursorCol, line);
    placeCursorAtIndex(value, idx);
    setMouseCursorCol(null);
    setMouseCursorLine(null);
  }, [mouseCursorCol, mouseCursorLine, value, overlay, setMouseCursorCol, setMouseCursorLine]);

  // 滚轮移光标
  useEffect(() => {
    if (inputCursorShift === null || overlay || showComp) return;
    const [line, col] = cursorPosRef.current;
    if (inputCursorShift.dir === "up" && line > 0) {
      placeCursor(value, [line - 1, col]);
    } else if (inputCursorShift.dir === "down") {
      placeCursor(value, [line + 1, col]);
    }
  }, [inputCursorShift, overlay, showComp, value]);

  const { hasTextSel } = useInputSelection({
    boxRef,
    value,
    onChange,
    colOffset: 4,
    setCursor: (pos) => placeCursor(value, pos),
    active: !overlay,
  });

  useImeCursor({
    focused: !overlay,
    value,
    cursor: cursorPos[1],
    rows: term.rows,
    inputRowFromBottom: 2,
    colOffset: 4,
    cursorLine: cursorPos[0],
    viewportLines: 4,
  });

  const handleChange = (v: string) => {
    const cleaned = scrubInput(v);
    valueRef.current = cleaned;
    onChange(cleaned);

    // 光标以 onCursorChange 为准（库 setValue 后会 setCursor → onCursorChange）。
    // 文末追加时乐观推进，避免受控间隙里光标慢一拍。
    const prev = value;
    const prevIdx = cursorIndexRef.current;
    if (prevIdx >= prev.length && cleaned.length >= prev.length) {
      placeCursorAtIndex(cleaned, cleaned.length);
    } else if (cleaned.length < prev.length) {
      placeCursorAtIndex(cleaned, Math.min(prevIdx, cleaned.length));
    }

    if (!applyingHistoryRef.current && !applyingCompletionRef.current) {
      refreshCompletion(cleaned, cursorIndexRef.current);
    }

    if (!applyingHistoryRef.current && useStore.getState().historyIndex >= 0) {
      useStore.getState().resetHistoryIndex();
      savedInputRef.current = null;
    }
  };

  /**
   * 接受补全（收口路径）：
   * 1. 光标对齐 prefix 末尾（range.end）
   * 2. 优先 taRef.insert(后缀) —— 库推进 value+cursor，onCursorChange 写回 state
   * 3. 否则整段 applyCompletion + 唯一 placeCursorAtIndex
   */
  const acceptCompletion = () => {
    if (acceptingRef.current) return;
    const store = useStore.getState();
    const comp = store.completion;
    if (!comp?.items?.length) {
      store.closeCompletion();
      return;
    }
    const sel = comp.items[comp.sel];
    if (!sel) {
      store.closeCompletion();
      return;
    }

    const text = valueRef.current;
    let range = comp.range;
    if (
      cursorIndexRef.current !== range.end ||
      range.start > cursorIndexRef.current
    ) {
      const again = complete(text, cursorIndexRef.current);
      if (again.items.some((it) => it.value === sel.value)) {
        range = again.range;
      }
    }

    acceptingRef.current = true;
    applyingCompletionRef.current = true;
    store.closeCompletion();

    const prefix = text.slice(range.start, range.end);
    const after = text.slice(range.end);
    const suffix = completionInsertSuffix(prefix, sel, after);
    // insert 用的是「当前渲染帧」的受控光标；仅当已在 range.end 时才能插对位置
    const cursorAtTokenEnd = cursorIndexRef.current === range.end;

    if (suffix !== null && cursorAtTokenEnd && taRef.current) {
      // 主路径：库 insert（官方 autocomplete 推荐）
      if (suffix.length > 0) {
        taRef.current.insert(suffix);
      }
      // 受控模式下立刻对齐父 value + 唯一光标写入（不靠 timeout/forced）
      const newText = text.slice(0, range.end) + suffix + text.slice(range.end);
      valueRef.current = newText;
      onChange(newText);
      placeCursorAtIndex(newText, range.end + suffix.length);
    } else {
      // 回退：光标不在 token 末尾或无法后缀插入 → 整段替换 + 单次 placeCursor
      const result = applyCompletion(text, sel, range);
      valueRef.current = result.text;
      onChange(result.text);
      placeCursorAtIndex(result.text, result.cursorIndex);
    }

    queueMicrotask(() => {
      applyingCompletionRef.current = false;
    });
    setTimeout(() => {
      acceptingRef.current = false;
    }, 80);
  };

  const doSubmit = (v: string) => {
    if (useStore.getState().completion?.items?.length) {
      acceptCompletion();
      return;
    }
    const trimmed = scrubInput(v).trim();
    if (!trimmed) return;

    useStore.getState().pushInputHistory(trimmed);
    clearInputChrome();

    const slashMatch = trimmed.match(/^\/(\w+)(?:\s|$)/);
    if (slashMatch && useStore.getState().isLocalCommand(slashMatch[1]!)) {
      useStore.getState().runCommand(slashMatch[1]!);
      applyingCompletionRef.current = true;
      onChange("");
      placeCursorAtIndex("", 0);
      applyingCompletionRef.current = false;
      return;
    }

    savedInputRef.current = null;
    onSubmit(trimmed);
    applyingCompletionRef.current = true;
    onChange("");
    placeCursorAtIndex("", 0);
    applyingCompletionRef.current = false;
  };

  const fieldBg = t.inputFieldBg;
  const footerBg = t.footerBg;
  const inputLines = Math.max(1, Math.min(4, value.split("\n").length || 1));

  return (
    <Box flexShrink={0} flexDirection="column" backgroundColor={footerBg} width="100%">
      {showComp && (
        <Box flexDirection="column" paddingLeft={2} backgroundColor={footerBg} width="100%">
          {completion!.items.slice(0, 5).map((it, i) => (
            <Text
              key={it.value}
              backgroundColor={footerBg}
              color={i === completion!.sel ? "#000000" : t.userBg}
              bold={i === completion!.sel}
            >
              {i === completion!.sel ? "▸ " : "  "}
              {it.label}{" "}
              <Text backgroundColor={footerBg} color="#808080">
                {it.description}
              </Text>
            </Text>
          ))}
          <Text backgroundColor={footerBg} color={t.userBg}>
            {" ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭"}
          </Text>
        </Box>
      )}

      <Box
        ref={boxRef}
        flexDirection="row"
        width="100%"
        backgroundColor={footerBg}
        minHeight={inputLines}
      >
        <Text backgroundColor={footerBg} color={t.accent} bold>
          {" ❯ "}
        </Text>
        <Box flexGrow={1} flexShrink={1} backgroundColor={fieldBg} minHeight={inputLines}>
          <TextArea
            ref={taRef}
            focus={!overlay}
            value={value}
            // 始终受控：父组件必须跟随 onCursorChange，否则打字光标会卡住
            cursorPosition={cursorPos}
            onChange={handleChange}
            onSubmit={doSubmit}
            onTab={(_shift) => {
              if (showComp) acceptCompletion();
            }}
            placeholder={
              streaming
                ? pendingCount > 0
                  ? `生成中… 已排队 ${pendingCount} 条（Enter 继续排队 · Esc 中断）`
                  : "生成中…（Enter 排队下一条 · Esc 中断）"
                : "输入文字…（/ 命令 · Ctrl+E 全屏）"
            }
            initialLineCount={1}
            viewportLines={4}
            highlightActiveLine={false}
            disableCursorBlink={true}
            autoNewLineLimit={0}
            keybindings={
              showComp
                ? { "Ctrl+E": false, "Up": false, "Down": false }
                : hasTextSel
                  ? { "Ctrl+E": false, "Backspace": false, "Delete": false }
                  : { "Ctrl+E": false }
            }
            onCursorChange={(pos) => {
              // 库在受控模式下打字/移动都会走这里；必须写回 state，光标才会跟字
              const text = valueRef.current;
              cursorPosRef.current = pos;
              setCursorPos(pos);
              const idx = cursorToIndex(text, pos[0], pos[1]);
              cursorIndexRef.current = idx;
              if (!applyingCompletionRef.current && !applyingHistoryRef.current) {
                refreshCompletion(text, idx);
              }
            }}
            onFirstLineUp={() => {
              if (showComp) return;
              const [line, col] = cursorPosRef.current;
              if (line > 0 || col > 0) {
                placeCursor(value, [0, 0]);
              } else {
                if (useStore.getState().historyIndex < 0) {
                  savedInputRef.current = value;
                }
                const prev = useStore.getState().navigateHistory("up");
                if (prev !== null) applyHistoryText(prev);
              }
            }}
            onLastLineDown={() => {
              if (showComp) return;
              const next = useStore.getState().navigateHistory("down");
              if (next !== null) {
                if (next === "") {
                  applyHistoryText(savedInputRef.current ?? "");
                  savedInputRef.current = null;
                } else {
                  applyHistoryText(next);
                }
              }
            }}
            onFirstCharacterLeft={() => {
              if (value === "" && !useStore.getState().overlay) {
                useStore.getState().setOverlay("agents");
              }
            }}
            styles={{
              text: { color: t.fg, bgColor: fieldBg, bold: true },
              placeholder: { color: t.muted, bgColor: fieldBg, italic: true },
            }}
          />
        </Box>
        <Text backgroundColor={footerBg}>{" "}</Text>
      </Box>
    </Box>
  );
}
