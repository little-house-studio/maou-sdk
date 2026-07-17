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

import React, { useRef, useState, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { TextArea, type TextAreaHandle, type TLabels } from "react-ink-textarea";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useImeCursor } from "../hooks/useImeCursor.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { useInputSelection } from "../hooks/useInputSelection.js";
import { colToIndex } from "../input/hit-test.js";
import {
  cursorToIndex,
  indexToCursor,
  completionInsertSuffix,
  applyCompletion,
  complete,
  getSlashCommands,
} from "../overlay/Completer.js";
import {
  clearSelection as vramClearSelection,
  notifyCursorActivity,
} from "../render/vram-layer.js";
import { clearActiveSel } from "../render/selection-model.js";
import {
  deleteBackwardTo,
  findPrevSentenceBoundary,
  findPrevWordBoundary,
  prevCodePointIndex,
} from "../input/text-edit.js";
import {
  noteInputContentWidth,
  scheduleIdleViewportCheck,
  setImePinTarget,
  restoreTerminalViewport,
  countInputVisualLines,
  inputContentCols,
} from "../input/terminal-viewport.js";
import stringWidth from "string-width";
import { getElementRect } from "../input/click-target.js";

/** 计算机蓝 —— 光标/选区/可识别指令同色 */
const COMPUTER_BLUE = "#2121FF";

/** 输入框最大可见视觉行（软折行也算）；超过内部滚动 */
const INPUT_VP = 5;

/** 识别为已注册斜杠指令时，整段 token 高亮 */
function buildCommandLabels(): TLabels {
  const names = getSlashCommands()
    .map((c) => c.value.replace(/^\//, ""))
    .filter((n) => /^[\w-]+$/.test(n));
  if (names.length === 0) return [];
  const alt = names
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  // 行首完整指令：/model、/compact 等（后跟空白或结尾）
  return [
    {
      pattern: new RegExp(`^/(?:${alt})(?=\\s|$)`, "gm"),
      label: "command",
    },
  ];
}

/** 粘贴：多字符一次插入时，光标落到插入段末尾 */
function cursorAfterInsert(prev: string, next: string, prevCursor: number): number | null {
  if (next.length <= prev.length + 1) return null; // 单字输入不走粘贴逻辑
  // 公共前缀
  let i = 0;
  const minLen = Math.min(prev.length, next.length);
  while (i < minLen && prev[i] === next[i]) i++;
  // 公共后缀
  let j = 0;
  while (
    j < prev.length - i &&
    j < next.length - i &&
    prev[prev.length - 1 - j] === next[next.length - 1 - j]
  ) {
    j++;
  }
  const insertEnd = next.length - j;
  // 插入段长度
  const insertLen = insertEnd - i;
  if (insertLen <= 1) return null;
  return insertEnd;
}

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
  /** 粘贴后锁定光标到插入段末尾，防止 onCursorChange 抢回旧位置 */
  const pasteCursorLockRef = useRef<number | null>(null);
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

  // 内容可用列：❯ 前缀 2 + 右侧滚动条槽 1
  const contentCols = useMemo(() => inputContentCols(term.cols), [term.cols]);
  // 视觉行（含软折行）—— 外壳高度 / 命中 / 滚动条 都用它，不能只数 \n
  const visualTotal = useMemo(
    () => countInputVisualLines(value, contentCols),
    [value, contentCols],
  );
  const inputLines = Math.max(1, Math.min(INPUT_VP, visualTotal));
  const showInputScroll = visualTotal > INPUT_VP;

  useEffect(() => {
    // 上报「视觉总行数」（未封顶）：
    // · 滚轮分流用 visualTotal > 5 判断是否滚输入视口
    // · hit-test fallback 自己 min(5, n)；有 inputRect 时用实测高度
    setInputLineCount(visualTotal);
  }, [visualTotal, setInputLineCount]);

  // IME / 超长行：检测逻辑溢出；回落后恢复终端横向视口
  useEffect(() => {
    noteInputContentWidth(value, contentCols);
    // 组字结束常见：value 稳定后右侧不再需要溢出 → 空闲再确认一次恢复
    scheduleIdleViewportCheck(150);
  }, [value, contentCols]);

  // 上报 IME 硬件光标锚点（屏幕 1-based）；setImePinTarget 内会钳制并记录越界 latch
  useEffect(() => {
    if (overlay) {
      setImePinTarget(null);
      return;
    }
    const rect = getElementRect(boxRef.current);
    const rows = term.rows;
    const cols = term.cols;
    const colOffset = 2; // "❯ " 视觉宽
    let row: number;
    let col: number;
    if (rect && rect.width > 0 && rect.height > 0) {
      const line = Math.min(cursorPos[0], Math.max(0, rect.height - 1));
      row = rect.top + line;
      const lineText = value.split("\n")[cursorPos[0]] ?? "";
      const before = Array.from(lineText).slice(0, cursorPos[1]).join("");
      const contentW = Math.max(8, rect.width - colOffset);
      const vis = stringWidth(before);
      // 未 wrap 的原始列（可能 > cols）用于触发 overflow latch
      const rawCol = rect.left + colOffset + vis;
      const wrappedCol = rect.left + colOffset + (vis % contentW);
      // 传 rawCol 若越界则 latch；setImePinTarget 再钳到屏幕内
      col = rawCol > cols ? rawCol : wrappedCol;
    } else {
      row = Math.max(1, rows - 2);
      col = 4 + stringWidth(value.split("\n").pop() ?? "");
    }
    setImePinTarget({ focused: true, row, col, cols, rows });
  }, [value, cursorPos, overlay, term.cols, term.rows]);

  useEffect(() => {
    if (overlay) {
      useStore.getState().setInputTextSel(null);
      clearActiveSel();
      vramClearSelection();
      setImePinTarget(null);
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
    colOffset: 2,
    setCursor: (pos) => placeCursor(value, pos),
    active: !overlay,
  });

  /**
   * 退格统一在此处理（关掉 TextArea 的 Backspace/Alt+Backspace，避免双删）：
   *   · 普通 Backspace → 删一字
   *   · Alt/Option+Backspace（及 Ctrl+W）→ 按词删
   *   · Ctrl+Backspace → 按句删
   * 有选区时：一律删掉选区（与标准编辑器一致）
   */
  useCleanInput((_input, key) => {
    if (overlay) return;

    // Ctrl+W：按词删（与 bash 习惯一致；部分终端 Alt+BS 会映射成这个）
    const isCtrlW =
      key.ctrl && !key.meta && (_input === "\x17" || _input === "w" || _input === "W");
    if (!key.backspace && !isCtrlW) return;

    // 有选区：整段删除
    const ts = useStore.getState().inputTextSel;
    if (ts && ts.startIdx !== ts.endIdx) {
      let s = ts.startIdx, e = ts.endIdx;
      if (s > e) [s, e] = [e, s];
      const text = valueRef.current;
      const newText = text.slice(0, s) + text.slice(e);
      valueRef.current = newText;
      onChange(newText);
      useStore.getState().setInputTextSel(null);
      clearActiveSel();
      vramClearSelection();
      placeCursorAtIndex(newText, s);
      refreshCompletion(newText, s);
      return;
    }

    const text = valueRef.current;
    const cursor = cursorIndexRef.current;
    if (cursor <= 0) return;

    // 优先级：Ctrl+Backspace 句 > Alt/Meta+Backspace 或 Ctrl+W 词 > 普通一字
    let boundary: number;
    if (key.backspace && key.ctrl && !key.meta) {
      boundary = findPrevSentenceBoundary(text, cursor);
    } else if (
      isCtrlW ||
      (key.backspace && (key.meta || (key as { alt?: boolean }).alt === true))
    ) {
      boundary = findPrevWordBoundary(text, cursor);
    } else {
      boundary = prevCodePointIndex(text, cursor);
    }

    const { text: newText, cursor: newCur } = deleteBackwardTo(text, cursor, boundary);
    if (newText === text) return;
    valueRef.current = newText;
    onChange(newText);
    placeCursorAtIndex(newText, newCur);
    refreshCompletion(newText, newCur);
  });

  useImeCursor({
    focused: !overlay,
    value,
    cursor: cursorPos[1],
    rows: term.rows,
    inputRowFromBottom: 2,
    colOffset: 2,
    cursorLine: cursorPos[0],
    viewportLines: 5,
  });

  const handleChange = (v: string) => {
    const cleaned = scrubInput(v);
    const prev = valueRef.current;
    const prevIdx = cursorIndexRef.current;
    valueRef.current = cleaned;
    onChange(cleaned);

    // 打字/粘贴时清掉输入选区，避免蓝块伪第二光标
    const ts = useStore.getState().inputTextSel;
    if (ts) {
      useStore.getState().setInputTextSel(null);
      clearActiveSel();
      vramClearSelection();
    }

    // 粘贴：多字符一次插入 → 光标到粘贴段末尾
    const pasteEnd = cursorAfterInsert(prev, cleaned, prevIdx);
    if (pasteEnd !== null) {
      pasteCursorLockRef.current = pasteEnd;
      placeCursorAtIndex(cleaned, pasteEnd);
      queueMicrotask(() => {
        if (pasteCursorLockRef.current === pasteEnd) {
          placeCursorAtIndex(valueRef.current, pasteEnd);
        }
        pasteCursorLockRef.current = null;
      });
    } else if (prevIdx >= prev.length && cleaned.length >= prev.length) {
      // 文末追加时乐观推进，避免受控间隙里光标慢一拍
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

  const commandLabels = useMemo(() => buildCommandLabels(), [showComp, value]);

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

    // 发送前复位视口，避免带偏的横向滚动进下一轮
    restoreTerminalViewport();
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
  /** 补全弹出层：计算机蓝，与 footer 浅灰区分 */
  const compBg = t.info;

  return (
    <Box flexShrink={0} flexDirection="column" backgroundColor={footerBg} width="100%">
      {showComp && (
        <Box flexDirection="column" paddingLeft={1} backgroundColor={compBg} width="100%">
          {completion!.items.slice(0, 5).map((it, i) => {
            const isSel = i === completion!.sel;
            // 选中行：荧光黄绿底 + 黑字；未选中：计算机蓝底 + 白字
            const rowBg = isSel ? t.accent : compBg;
            const rowFg = isSel ? "#000000" : "#FFFFFF";
            const descFg = isSel ? "#242424" : "#A8A8FF";
            return (
              <Text
                key={it.value}
                backgroundColor={rowBg}
                color={rowFg}
                bold={isSel}
              >
                {isSel ? "▸ " : "  "}
                {it.label}{" "}
                <Text backgroundColor={rowBg} color={descFg}>
                  {it.description}
                </Text>
              </Text>
            );
          })}
          <Text backgroundColor={compBg} color="#C5C5FF">
            {" ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭"}
          </Text>
        </Box>
      )}

      <Box
        ref={boxRef}
        flexDirection="row"
        width="100%"
        backgroundColor={footerBg}
        height={inputLines}
        minHeight={inputLines}
      >
        {/* 与 EventBlock 对齐：无额外左缩进，❯ + 空格 */}
        <Text backgroundColor={footerBg} color="#000000" bold>
          {"❯ "}
        </Text>
        {/*
          显式 width=contentCols：让 TextArea 的 useBoxMetrics 立刻量到稳定列宽，
          触发 buildVisualRows 软折行。若 width 测成 0，超长单行不会折，只显示 1 行并裁切。
          flexShrink=0：防止终端高度紧张时把输入区压回 1 行。
        */}
        <Box
          width={contentCols}
          flexShrink={0}
          backgroundColor={fieldBg}
          height={inputLines}
          minHeight={inputLines}
          overflow="hidden"
        >
          <TextArea
            ref={taRef}
            // 有选区时失焦：隐藏 Ink 插入光标（标准编辑器：选区与光标互斥）
            focus={!overlay && !hasTextSel}
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
            viewportLines={INPUT_VP}
            highlightActiveLine={false}
            disableCursorBlink={false}
            cursorInterval={530}
            autoNewLineLimit={0}
            keybindings={
              showComp
                ? {
                    "Ctrl+E": false,
                    "Up": false,
                    "Down": false,
                    // 退格全交 InputBar（词/句/字）
                    "Backspace": false,
                    "Alt+Backspace": false,
                    "Ctrl+W": false,
                  }
                : hasTextSel
                  ? {
                      "Ctrl+E": false,
                      "Backspace": false,
                      "Alt+Backspace": false,
                      "Ctrl+W": false,
                      "Delete": false,
                    }
                  : {
                      "Ctrl+E": false,
                      "Backspace": false,
                      "Alt+Backspace": false,
                      "Ctrl+W": false,
                    }
            }
            onCursorChange={(pos) => {
              // 粘贴锁：强制停在插入段末尾
              if (pasteCursorLockRef.current !== null) {
                placeCursorAtIndex(valueRef.current, pasteCursorLockRef.current);
                return;
              }
              // 库在受控模式下打字/移动都会走这里；必须写回 state，光标才会跟字
              const text = valueRef.current;
              cursorPosRef.current = pos;
              setCursorPos(pos);
              const idx = cursorToIndex(text, pos[0], pos[1]);
              cursorIndexRef.current = idx;
              // 移动/输入时重置闪烁为「亮」，避免刚好灭掉
              notifyCursorActivity();
              if (!applyingCompletionRef.current && !applyingHistoryRef.current) {
                refreshCompletion(text, idx);
              }
            }}
            onFirstLineUp={() => {
              // 第 1 行再 ↑ → 上一条历史，光标置最前
              if (showComp) return;
              if (useStore.getState().historyIndex < 0) {
                savedInputRef.current = valueRef.current;
              }
              const prev = useStore.getState().navigateHistory("up");
              if (prev !== null) {
                applyingHistoryRef.current = true;
                onChange(prev);
                useStore.getState().closeCompletion();
                placeCursorAtIndex(prev, 0);
                queueMicrotask(() => {
                  applyingHistoryRef.current = false;
                });
              }
            }}
            onLastLineDown={() => {
              // 末行再 ↓ → 下一条历史（无则回到草稿/不动）
              if (showComp) return;
              const next = useStore.getState().navigateHistory("down");
              if (next !== null) {
                if (next === "") {
                  const draft = savedInputRef.current ?? "";
                  savedInputRef.current = null;
                  applyHistoryText(draft);
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
            labels={commandLabels}
            styles={{
              text: { color: "#000000", bgColor: fieldBg, bold: true },
              placeholder: { color: "#000000", bgColor: fieldBg, italic: true },
              // 可识别斜杠指令：计算机蓝字
              command: { color: COMPUTER_BLUE, bgColor: fieldBg, bold: true },
            }}
          />
        </Box>
        {/* 超 5 行：右侧细滚动条（示意位置） */}
        {showInputScroll ? (
          <Text backgroundColor={footerBg} color={t.accent}>
            {"▐"}
          </Text>
        ) : (
          <Text backgroundColor={footerBg}>{" "}</Text>
        )}
      </Box>
    </Box>
  );
}
