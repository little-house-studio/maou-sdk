/** StatusBar — agent状态 + 上下文条 */
import React from "react";
import { Box, Text } from "ink";
import { useStore } from "../state/store.js";
import { currentTheme as t } from "../theme.js";

export function StatusBar() {
  const { streaming, tokenHistory, totalInput, totalOutput, round } = useStore();
  const lastTok = tokenHistory[tokenHistory.length - 1] ?? 0;
  const maxCtx = 100000;
  const pct = Math.min(1, lastTok / maxCtx);
  const filled = Math.round(pct * 10);
  const barColor = pct > 0.8 ? t.status.err : pct > 0.5 ? t.status.warn : t.accent;

  return (
    <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
      <Box gap={1}>
        <Text color={streaming ? t.accent2 : t.dim}>{streaming ? "● 运行中" : "○ 空闲"}</Text>
        <Text color={t.dim}>│ 轮次 {round}</Text>
        <Text color={t.dim}>│ {lastTok}/{maxCtx} </Text>
        <Text color={barColor}>{"█".repeat(filled)}{"░".repeat(10 - filled)}</Text>
        <Text color={t.dim}> {Math.round(pct * 100)}% · 缓存 —</Text>
      </Box>
      <Text color={t.dim}>Ctrl+K · Ctrl+G · Ctrl+C</Text>
    </Box>
  );
}
