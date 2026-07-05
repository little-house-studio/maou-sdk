/**
 * InputBar —— 多行输入框（react-ink-textarea）。
 * 默认 1 行，自适应高度到 viewportLines，超过开启内部滚动。
 * Enter 发送 / Alt+Enter 换行 / Ctrl+E 全屏编辑器 / Ctrl+G 外部编辑器。
 * `/` 触发斜杠命令补全（光标上方 overlay）。
 */

import React, { useRef, useState } from "react";
import { Box, Text } from "ink";
import { TextArea, type TextAreaHandle } from "react-ink-textarea";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useImeCursor } from "../hooks/useImeCursor.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { complete, type CompletionItem } from "../overlay/Completer.js";
import { colToIndex } from "../input/hit-test.js";
import { useEffect } from "react";

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
  const setInputLineCount = useStore((s) => s.setInputLineCount);
  const inputCursorShift = useStore((s) => s.inputCursorShift);
  const taRef = useRef<TextAreaHandle>(null);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [forcedCursor, setForcedCursor] = useState<[number, number] | null>(null);
  const [showComp, setShowComp] = useState(false);
  const [compItems, setCompItems] = useState<CompletionItem[]>([]);
  const [compSel, setCompSel] = useState(0);

  // 上报当前内容行数到 store（供鼠标滚轮分流判断 >viewportLines）
  useEffect(() => {
    setInputLineCount(Math.max(1, value.split("\n").length));
  }, [value, setInputLineCount]);

  // 鼠标点击移光标：mouseCursorCol（字符列）→ 字符索引 → 一次性设 cursorPosition
  useEffect(() => {
    if (mouseCursorCol === null) return;
    const idx = colToIndex(value, mouseCursorCol);
    setForcedCursor([0, idx]);
    setMouseCursorCol(null);
    // 下一帧清掉，让键盘光标移动恢复
    const id = setTimeout(() => setForcedCursor(null), 50);
    return () => clearTimeout(id);
  }, [mouseCursorCol, value, setMouseCursorCol]);

  // 滚轮驱动 InputBar 光标移动（内容 >4 行时，鼠标在输入框行内滚轮）
  // nonce 变化即触发一次；dir=up 光标上移一行，down 下移一行（让 textarea 内部滚动跟随）
  useEffect(() => {
    if (inputCursorShift === null) return;
    const [line, col] = cursor;
    if (inputCursorShift.dir === "up" && line > 0) {
      setForcedCursor([line - 1, col]);
    } else if (inputCursorShift.dir === "down") {
      setForcedCursor([line + 1, col]);
    }
    const id = setTimeout(() => setForcedCursor(null), 50);
    return () => clearTimeout(id);
  }, [inputCursorShift, cursor]);

  // IME 硬件光标定位（输入框获焦时显示，候选窗跟随）
  // 传 cursorLine 修正多行场景的硬件光标行位置（避免双光标）
  // colOffset=4：paddingX(1) + " ❯ "(3) = 4 列（0-based），与 InputBar 渲染结构一致
  // inputRowFromBottom=2：状态栏(1) + InputBar(2)，与 hit-test.ts LayoutRect 一致
  useImeCursor({
    focused: true,
    value,
    cursor: cursor[1],
    rows: term.rows,
    inputRowFromBottom: 2,
    colOffset: 4,
    cursorLine: cursor[0],
    viewportLines: 4,
  });

  const handleChange = (v: string) => {
    onChange(v);
    const { items } = complete(v);
    if (items.length > 0) {
      setCompItems(items);
      setShowComp(true);
      setCompSel(0);
    } else {
      setShowComp(false);
    }
  };

  const acceptCompletion = () => {
    const sel = compItems[compSel];
    if (sel) {
      const v = sel.value + " ";
      onChange(v);  // 受控 value 设完整值（含已有前缀），不调 insert 避免叠加
      setShowComp(false);
    }
  };

  const cycleCompletion = (shift: boolean) => {
    if (compItems.length === 0) return;
    setCompSel(s => {
      const next = shift ? (s - 1 + compItems.length) % compItems.length : (s + 1) % compItems.length;
      return next;
    });
  };

  return (
    <Box flexShrink={0} flexDirection="column">
      {/* 补全菜单（光标上方） */}
      {showComp && compItems.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {compItems.slice(0, 5).map((it, i) => (
            <Text key={it.value} color={i === compSel ? t.accent : t.dim}>
              {i === compSel ? "▸ " : "  "}{it.label} <Text color={t.muted}>{it.description}</Text>
            </Text>
          ))}
          <Text color={t.dim}> Tab 确认 · Shift+Tab 切换 · Esc 关闭</Text>
        </Box>
      )}

      <Box paddingX={1}>
        <Text color={t.accent} bold> ❯ </Text>
        <TextArea
          ref={taRef}
          focus
          value={value}
          cursorPosition={forcedCursor ?? undefined}
          onChange={handleChange}
          onSubmit={(v) => {
            if (v.trim()) {
              useStore.getState().pushInputHistory(v.trim());
              useStore.getState().resetHistoryIndex();
              onSubmit(v.trim());
              onChange("");
            }
          }}
          onTab={(shift) => { if (showComp) { if (shift) cycleCompletion(true); else acceptCompletion(); } }}
          placeholder={
            streaming
              ? pendingCount > 0
                ? `生成中… 已排队 ${pendingCount} 条（Enter 继续排队 · Esc 中断）`
                : "生成中…（Enter 排队下一条 · Esc 中断）"
              : "输入文字…（/ 命令 · Ctrl+E 全屏 · Ctrl+G 编辑器）"
          }
          initialLineCount={1}
          viewportLines={4}
          highlightActiveLine
          activeLineColor={t.selectedBg}
          disableCursorBlink={false}
          // 禁用 Ctrl+E 默认（行尾），交由外层 useCleanInput 触发全屏编辑器
          keybindings={{ "Ctrl+E": false }}
          onCursorChange={(pos) => setCursor(pos)}
          onFirstLineUp={() => {
            // 上键在第一行 → 回溯输入历史
            const prev = useStore.getState().navigateHistory("up");
            if (prev !== null) onChange(prev);
          }}
          onLastLineDown={() => {
            // 下键在最后一行 → 前进历史（回到空 = 最新）
            const next = useStore.getState().navigateHistory("down");
            if (next !== null) onChange(next);
          }}
          styles={{ text: { color: t.fg }, placeholder: { color: t.dim, italic: true } }}
        />
      </Box>
    </Box>
  );
}
