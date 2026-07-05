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
 */

import React, { useRef, useState } from "react";
import { Box, Text } from "ink";
import { TextArea, type TextAreaHandle } from "react-ink-textarea";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useImeCursor } from "../hooks/useImeCursor.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
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
  const completion = useStore((s) => s.completion);
  const taRef = useRef<TextAreaHandle>(null);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [forcedCursor, setForcedCursor] = useState<[number, number] | null>(null);

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
    // 补全状态提升到 store：输入变化时重算候选
    useStore.getState().updateCompletion(v);
  };

  // 补全确认：返回补全后的完整文本（含已有前缀）
  const acceptCompletion = () => {
    const filled = useStore.getState().acceptCompletion();
    if (filled !== null) onChange(filled);
  };

  // 补全菜单显示时，上下键选菜单而非移光标/历史
  const showComp = completion !== null;

  return (
    <Box flexShrink={0} flexDirection="column">
      {/* 补全菜单（光标上方） */}
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

      <Box paddingX={1}>
        <Text color={t.accent} bold> ❯ </Text>
        <TextArea
          ref={taRef}
          focus
          value={value}
          cursorPosition={forcedCursor ?? undefined}
          onChange={handleChange}
          onSubmit={(v) => {
            // 补全菜单开时，Enter 先确认补全（不发送）
            if (useStore.getState().completion) { acceptCompletion(); return; }
            const trimmed = v.trim();
            if (!trimmed) return;
            // 斜杠命令拦截：匹配 /command 格式，不发送给 AI
            const slashMatch = trimmed.match(/^\/(\w+)/);
            if (slashMatch) {
              const cmdId = slashMatch[1];
              useStore.getState().pushInputHistory(trimmed);
              useStore.getState().resetHistoryIndex();
              useStore.getState().runCommand(cmdId);
              onChange("");
              return;
            }
            // 普通消息
            useStore.getState().pushInputHistory(trimmed);
            useStore.getState().resetHistoryIndex();
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
          highlightActiveLine
          activeLineColor={t.selectedBg}
          disableCursorBlink={false}
          // 禁用 Ctrl+E 默认（行尾），交由外层 useCleanInput 触发全屏编辑器
          // autoNewLineLimit=0：下键在最后一行时 trailingEmpty(0)>=0 恒真 → 走 onLastLineDown
          // （前进历史/不新建行）。默认值 3 会先新建 3 个空行才回调，违背 DESIGN。
          autoNewLineLimit={0}
          // 补全菜单显示时禁用 Up/Down，让按键冒泡到 app.tsx useCleanInput 选菜单（全覆盖，不限边界行）
          keybindings={showComp ? { "Ctrl+E": false, "Up": false, "Down": false } : { "Ctrl+E": false }}
          onCursorChange={(pos) => setCursor(pos)}
          onFirstLineUp={() => {
            // 补全菜单开时 Up 被 keybindings 禁用，由 app.tsx useCleanInput 选菜单，不会进这里。
            // DESIGN：光标不在 [0,0] → 先到最左上角；已在 [0,0] → 回溯输入历史
            const [line, col] = cursor;
            if (line > 0 || col > 0) {
              setForcedCursor([0, 0]);
              setTimeout(() => setForcedCursor(null), 50);
            } else {
              const prev = useStore.getState().navigateHistory("up");
              if (prev !== null) onChange(prev);
            }
          }}
          onLastLineDown={() => {
            // 同上：补全菜单开时 Down 被禁用。这里只处理历史前进。
            // DESIGN：下键不新建行。若在浏览历史 → 前进；否则无操作
            const next = useStore.getState().navigateHistory("down");
            if (next !== null) onChange(next);
          }}
          onFirstCharacterLeft={() => {
            // 空输入框按左键 → 进 agent 管理面板
            if (value === "") useStore.getState().setOverlay("agents");
          }}
          styles={{ text: { color: t.fg }, placeholder: { color: t.dim, italic: true } }}
        />
      </Box>
    </Box>
  );
}
