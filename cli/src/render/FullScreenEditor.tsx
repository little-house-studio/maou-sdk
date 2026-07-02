/**
 * FullScreenEditor —— Ctrl+E 全屏文字编辑器。
 * Ink 7 position="absolute" 占满整屏。Esc 返回（内容带回 InputBar）。
 * 全屏内 Enter 换行不发送；退出后 Enter 才发送（DESIGN.md 明确）。
 */

import React, { useState, useRef } from "react";
import { Box, Text } from "ink";
import { TextArea, type TextAreaHandle } from "react-ink-textarea";
import { useTheme } from "../theme/theme-context.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useCleanInput } from "../hooks/useCleanInput.js";
import { useStore } from "../state/store.js";

interface Props {
  initial: string;
  onExit: (value: string, submit: boolean) => void;
}

export function FullScreenEditor({ initial, onExit }: Props) {
  const t = useTheme();
  const term = useTerminalSize();
  const taRef = useRef<TextAreaHandle>(null);
  const [value, setValue] = useState(initial);

  // Esc 退出，值带回（react-ink-textarea keybindings 不支持 Esc，用 useCleanInput）
  useCleanInput((char, key) => {
    if (key.escape) onExit(value, false);
  });

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
        <Text color={t.accent} bold>// 全屏编辑器</Text>
        <Text color={t.dim}>Esc 返回 · Enter 换行（不发送）</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column" borderStyle="single" borderColor={t.borderAccent} paddingX={1}>
        <TextArea
          ref={taRef}
          focus
          value={value}
          onChange={setValue}
          onSubmit={() => { /* 全屏内 Enter 不提交：DESIGN.md 要求回车换行 */ }}
          // 禁用 Enter 提交，使其变为换行；Esc 退出由外层 useCleanInput 处理
          keybindings={{ "Enter": false }}
          initialLineCount={Math.max(1, term.rows - 6)}
          viewportLines={term.rows - 6}
          styles={{ text: { color: t.fg }, placeholder: { color: t.dim } }}
        />
      </Box>
      <Box paddingX={1} flexShrink={0}>
        <Text color={t.dim}>{value.length} 字</Text>
      </Box>
    </Box>
  );
}
