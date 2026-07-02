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
  const term = useTerminalSize();
  const mouseCursorCol = useStore((s) => s.mouseCursorCol);
  const setMouseCursorCol = useStore((s) => s.setMouseCursorCol);
  const taRef = useRef<TextAreaHandle>(null);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [forcedCursor, setForcedCursor] = useState<[number, number] | null>(null);
  const [showComp, setShowComp] = useState(false);
  const [compItems, setCompItems] = useState<CompletionItem[]>([]);
  const [compSel, setCompSel] = useState(0);

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

  // IME 硬件光标定位（输入框获焦时显示，候选窗跟随）
  useImeCursor({
    focused: !streaming,
    value,
    cursor: cursor[1],
    rows: term.rows,
    inputRowFromBottom: 2,
    colOffset: 2,
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
          focus={!streaming}
          value={value}
          cursorPosition={forcedCursor ?? undefined}
          onChange={handleChange}
          onSubmit={(v) => {
            if (v.trim() && !streaming) {
              onSubmit(v.trim());
              onChange("");
            }
          }}
          onTab={(shift) => { if (showComp) { if (shift) cycleCompletion(true); else acceptCompletion(); } }}
          placeholder={streaming ? "生成中…（Esc 中断）" : "输入文字…（/ 命令 · Ctrl+E 全屏 · Ctrl+G 编辑器）"}
          initialLineCount={1}
          viewportLines={4}
          highlightActiveLine
          activeLineColor={t.selectedBg}
          disableCursorBlink={false}
          // 禁用 Ctrl+E 默认（行尾），交由外层 useCleanInput 触发全屏编辑器
          keybindings={{ "Ctrl+E": false }}
          onCursorChange={(pos) => setCursor(pos)}
          styles={{ text: { color: t.fg }, placeholder: { color: t.dim, italic: true } }}
        />
      </Box>
    </Box>
  );
}
