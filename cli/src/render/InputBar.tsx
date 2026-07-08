/**
 * InputBar —— 多行输入框（react-ink-textarea）。
 * 默认 1 行，自适应高度到 viewportLines，超过开启内部滚动。
 * Enter 发送 / Alt+Enter 换行 / Ctrl+E 全屏编辑器 / Ctrl+G 外部编辑器。
 * `/` 触发斜杠命令补全（光标上方 overlay）。
 *
 * 按键设计（DESIGN.md）：
 *  - 上下键：光标在中间 → 移光标；到第一行按上 → 先到 [0,0]；再按上 → 回溯输入历史。
 *    最后一行按下 → 不新建行，前进历史；历史到末尾回空。
 *  - 补全菜单显示时：上下键选菜单（不移光标），Tab/Enter 确认，Esc 关闭。
 *  - 空输入框按左键 → 进 agent 管理面板。
 *
 * 修复：
 *  - cursor 用 ref 存最新值（避免闭包旧值）
 *  - 浏览历史前保存原始输入，下键到末尾恢复
 *  - colToIndex 用 [...text] 按 code point 遍历（修 emoji 代理对）
 *  - 补全确认去重（Tab/Enter 不双重触发）
 *  - forcedCursor 用 ref 管理 timeout（避免互相覆盖）
 *  - streaming 时发送走入队，但显示用户消息
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

interface Props {
  value: string;
  onSubmit: (text: string) => void;
  onChange: (v: string) => void;
  onFullEditor: (initial: string) => void;
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
  const showComp = completion !== null;
  const taRef = useRef<TextAreaHandle>(null);
  const boxRef = useRef<DOMElement | null>(null);
  const [forcedCursor, setForcedCursor] = useState<[number, number] | null>(null);

  // cursor 用 ref 存最新值（避免 onFirstLineUp 等回调用闭包旧值）
  const cursorRef = useRef<[number, number]>([0, 0]);
  // forcedCursor timeout 管理（避免互相覆盖）
  const forcedCursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // pending forced：设了 forcedCursor 后等 TextArea onCursorChange 确认到位再清，
  // 避免 50ms 提前清导致受控→非受控切换时 cursor 回退（光标闪回原位）
  const pendingForced = useRef<[number, number] | null>(null);
  // 浏览历史前保存原始输入（下键到末尾恢复）
  const savedInputRef = useRef<string | null>(null);

  const setForcedWithTimeout = (pos: [number, number]) => {
    if (forcedCursorTimer.current) clearTimeout(forcedCursorTimer.current);
    pendingForced.current = pos;
    setForcedCursor(pos);
    // 兜底：500ms 内 onCursorChange 没确认就强制清（防止卡死受控）
    forcedCursorTimer.current = setTimeout(() => {
      pendingForced.current = null;
      setForcedCursor(null);
      forcedCursorTimer.current = null;
    }, 500);
  };

  // 上报当前内容行数到 store
  useEffect(() => {
    setInputLineCount(Math.max(1, value.split("\n").length));
  }, [value, setInputLineCount]);

  // 鼠标点击移光标
  useEffect(() => {
    if (mouseCursorCol === null) return;
    const line = mouseCursorLine ?? 0;
    const idx = colToIndex(value, mouseCursorCol, line);
    setForcedWithTimeout([line, idx]);
    setMouseCursorCol(null);
    setMouseCursorLine(null);
  }, [mouseCursorCol, mouseCursorLine, value, setMouseCursorCol, setMouseCursorLine]);

  // 滚轮驱动 InputBar 光标移动
  useEffect(() => {
    if (inputCursorShift === null) return;
    const [line, col] = cursorRef.current;
    if (inputCursorShift.dir === "up" && line > 0) {
      setForcedWithTimeout([line - 1, col]);
    } else if (inputCursorShift.dir === "down") {
      setForcedWithTimeout([line + 1, col]);
    }
  }, [inputCursorShift]);

  // 文本选区（框选删除）：测量 inputRect、消费选区指令、蓝底同步、退格删除
  const { hasTextSel } = useInputSelection({
    boxRef,
    value,
    onChange,
    colOffset: 4,
    setCursor: setForcedWithTimeout,
    active: !overlay,
  });

  useImeCursor({
    focused: true,
    value,
    cursor: cursorRef.current[1],
    rows: term.rows,
    inputRowFromBottom: 2,
    colOffset: 4,
    cursorLine: cursorRef.current[0],
    viewportLines: 4,
  });

  const handleChange = (v: string) => {
    // 用户打字：清 forcedCursor（退出受控），让 TextArea 内部 cursor 接管（已被键盘更新到新位）
    if (pendingForced.current) {
      pendingForced.current = null;
      if (forcedCursorTimer.current) { clearTimeout(forcedCursorTimer.current); forcedCursorTimer.current = null; }
      setForcedCursor(null);
    }
    onChange(v);
    useStore.getState().updateCompletion(v);
    // 输入变化时重置历史浏览
    if (useStore.getState().historyIndex >= 0) {
      useStore.getState().resetHistoryIndex();
      savedInputRef.current = null;
    }
  };

  // 补全确认（防重复：用 ref 标记）
  const acceptingRef = useRef(false);
  const acceptCompletion = () => {
    if (acceptingRef.current) return; // 防重复
    const filled = useStore.getState().acceptCompletion();
    if (filled !== null) {
      acceptingRef.current = true;
      onChange(filled);
      setTimeout(() => { acceptingRef.current = false; }, 50);
    }
  };

  return (
    <Box flexShrink={0} flexDirection="column">
      {/* 补全菜单 */}
      {showComp && completion!.items.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {completion!.items.slice(0, 5).map((it, i) => (
            <Text key={it.value} color={i === completion!.sel ? t.accent : t.dim}>
              {i === completion!.sel ? "▸ " : "  "}{it.label} <Text color={t.muted}>{it.description}</Text>
            </Text>
          ))}
          <Text color={t.dim}> ↑↓ 选择 · Tab/Enter 确认 · Esc 关闭</Text>
        </Box>
      )}

      <Box ref={boxRef} paddingX={1}>
        <Text color={t.accent} bold> ❯ </Text>
        <TextArea
          ref={taRef}
          focus={!overlay}
          value={value}
          cursorPosition={forcedCursor ?? undefined}
          onChange={handleChange}
          onSubmit={(v) => {
            // 补全菜单开时，Enter 先确认补全（不发送）
            if (useStore.getState().completion) { acceptCompletion(); return; }
            const trimmed = v.trim();
            if (!trimmed) return;
            // 斜杠命令拦截
            const slashMatch = trimmed.match(/^\/(\w+)/);
            if (slashMatch) {
              const cmdId = slashMatch[1];
              useStore.getState().pushInputHistory(trimmed);
              useStore.getState().resetHistoryIndex();
              useStore.getState().runCommand(cmdId);
              onChange("");
              return;
            }
            // 普通消息：push 历史 + 发送
            useStore.getState().pushInputHistory(trimmed);
            useStore.getState().resetHistoryIndex();
            savedInputRef.current = null;
            onSubmit(trimmed);
            onChange("");
          }}
          onTab={(_shift) => { if (showComp) acceptCompletion(); }}
          placeholder={
            streaming
              ? pendingCount > 0
                ? `生成中… 已排队 ${pendingCount} 条（Enter 继续排队 · Esc 中断）`
                : "生成中…（Enter 排队下一条 · Esc 中断）"
              : "输入文字…（/ 命令 · Ctrl+E 全屏 · Ctrl+G 编辑器）"
          }
          initialLineCount={1}
          viewportLines={4}
          highlightActiveLine={false}
          disableCursorBlink={false}
          autoNewLineLimit={0}
          keybindings={
            showComp
              ? { "Ctrl+E": false, "Up": false, "Down": false }
              : hasTextSel
                ? { "Ctrl+E": false, "Backspace": false, "Delete": false }
                : { "Ctrl+E": false }
          }
          onCursorChange={(pos) => { cursorRef.current = pos; }}
          onFirstLineUp={() => {
            const [line, col] = cursorRef.current;
            if (line > 0 || col > 0) {
              setForcedWithTimeout([0, 0]);
            } else {
              // 回溯历史前保存当前输入
              if (useStore.getState().historyIndex < 0) {
                savedInputRef.current = value;
              }
              const prev = useStore.getState().navigateHistory("up");
              if (prev !== null) onChange(prev);
            }
          }}
          onLastLineDown={() => {
            const next = useStore.getState().navigateHistory("down");
            if (next !== null) {
              if (next === "") {
                // 到末尾，恢复原始输入
                onChange(savedInputRef.current ?? "");
                savedInputRef.current = null;
              } else {
                onChange(next);
              }
            }
          }}
          onFirstCharacterLeft={() => {
            if (value === "" && !useStore.getState().overlay) {
              useStore.getState().setOverlay("agents");
            }
          }}
          styles={{ text: { color: t.fg }, placeholder: { color: t.dim, italic: true } }}
        />
      </Box>
    </Box>
  );
}
