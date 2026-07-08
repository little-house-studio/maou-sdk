/**
 * FullScreenEditor —— Ctrl+E 全屏文字编辑器。
 * Ink 7 position="absolute" 占满整屏。Esc 返回（内容带回 InputBar）。
 * 全屏内 Enter 换行不发送；退出后 Enter 才发送（DESIGN.md 明确）。
 *
 * Markdown 轻量语法着色：用 react-ink-textarea 的 labels（字符级标签）
 * + styles 配色。仅着色标记符，不做块级渲染（代码块缩进/表格对齐等不支持）。
 */

import React, { useState, useRef, useEffect } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { TextArea, type TextAreaHandle, type TLabels, type TStyles } from "react-ink-textarea";
import { useTheme } from "../theme/theme-context.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { useInputSelection } from "../hooks/useInputSelection.js";
import { useStore } from "../state/store.js";

// ── Markdown 语法着色规则（字符级标签） ────────────────────────
// labels 机制：computeLabels 给每个字符打 label，同名 label 连续段用 styles[labelName] 渲染。
// 规则按优先级顺序匹配（后匹配的不覆盖已标记的非 text 字符）。
const MD_LABELS: TLabels = [
  // 标题行 ^#{1,6}\s...（整行着色）
  { pattern: /^#{1,6}\s.*$/gm, label: "heading" },
  // 引用行 ^>...
  { pattern: /^>.*/gm, label: "quote" },
  // 列表项 ^\s*[-*]\s
  { pattern: /^\s*[-*]\s/gm, label: "listBullet" },
  // 行内代码 `code`
  { pattern: /`[^`\n]+`/g, label: "code" },
  // 粗体 **text**
  { pattern: /\*\*[^*\n]+\*\*/g, label: "bold" },
  // 斜体 *text*（避免与粗体冲突，匹配单个 * 包裹）
  { pattern: /(^|[^*])\*[^*\n]+\*(?!\*)/g, label: (m) => {
    // TLabelFn：返回的 label 用于整段匹配；这里把前导非 * 字符也算进 italic 会影响着色，
    // 简化：仅当匹配不含前导字符时标记。回退到 italic。
    return m[0].startsWith("*") ? "italic" : undefined;
  }},
];

interface Props {
  initial: string;
  onExit: (value: string, submit: boolean) => void;
}

export function FullScreenEditor({ initial, onExit }: Props) {
  const t = useTheme();
  const term = useTerminalSize();
  const taRef = useRef<TextAreaHandle>(null);
  const boxRef = useRef<DOMElement | null>(null);
  const [value, setValue] = useState(initial);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [forcedCursor, setForcedCursor] = useState<[number, number] | null>(null);
  const inputCursorShift = useStore((s) => s.inputCursorShift);

  // 文本选区（框选删除）：全屏编辑器复用同一套，colOffset=1（无 ❯ 前缀，仅 paddingX=1）
  const { hasTextSel } = useInputSelection({
    boxRef,
    value,
    onChange: setValue,
    colOffset: 1,
    setCursor: (pos) => {
      setForcedCursor(pos);
      setTimeout(() => setForcedCursor(null), 50);
    },
    active: true,
  });

  // Esc 退出，值带回（react-ink-textarea keybindings 不支持 Esc，用 useCleanInput）
  useCleanInput((char, key) => {
    if (key.escape) onExit(value, false);
  });

  // 滚轮驱动光标移动（全屏开时，useMouseInput 的 rect 让滚轮走 onInputScroll → shiftInputCursor）
  // nonce 变化即触发；移光标让 textarea 内部滚动跟随
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

  // Markdown 标签 → 样式配色（复用 theme）
  const mdStyles: TStyles = {
    text: { color: t.fg },
    placeholder: { color: t.dim, italic: true },
    heading: { color: t.accent, bold: true },
    quote: { color: t.muted, italic: true },
    listBullet: { color: t.accent },
    code: { color: t.accent2 },
    bold: { bold: true },
    italic: { italic: true },
  };

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width={term.cols}
      height={term.rows}
      flexDirection="column"
      backgroundColor={t.bg}
    >
      <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
        <Text color={t.accent} bold>// 全屏编辑器 · Markdown</Text>
        <Text color={t.dim}>Esc 返回 · Enter 换行（不发送）</Text>
      </Box>
      <Box ref={boxRef} flexGrow={1} flexDirection="column" borderStyle="single" borderColor={t.borderAccent} paddingX={1}>
        <TextArea
          ref={taRef}
          focus
          value={value}
          cursorPosition={forcedCursor ?? undefined}
          onChange={setValue}
          onCursorChange={(pos) => setCursor(pos)}
          onSubmit={() => { /* 全屏内 Enter 不提交：DESIGN.md 要求回车换行 */ }}
          // 禁用 Enter 提交（变换行）；有文本选区时禁 Backspace/Delete（由 useInputSelection 接管删选区）
          keybindings={hasTextSel ? { "Enter": false, "Backspace": false, "Delete": false } : { "Enter": false }}
          initialLineCount={Math.max(1, term.rows - 6)}
          viewportLines={term.rows - 6}
          labels={MD_LABELS}
          styles={mdStyles}
        />
      </Box>
      <Box paddingX={1} flexShrink={0}>
        <Text color={t.dim}>{value.length} 字 · {value.split("\n").length} 行</Text>
      </Box>
    </Box>
  );
}
