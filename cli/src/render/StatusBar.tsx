/**
 * StatusBar —— 磁带复古未来主义状态栏。
 * REC ● HH:MM:SS [ch.NN] ▌ agentName ▸ think:N │ token/maxContext [bar] pct% sparkline cache% │ 状态
 * maxContext 从 preset 拿真实值（修复旧硬编码 100000）。
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { timecode, channel, thinkingLabel, compact, bar } from "../layout/decorators.js";
import { Sparkline } from "./sparkline.js";

export function StatusBar() {
  const t = useTheme();
  const { streaming, agentName, provider, model, maxContext, round, thinkingLevel, rounds, cacheHistory, currentRoundUsage } = useStore();
  const term = useTerminalSize();
  const [now, setNow] = useState(() => new Date());

  // 时码独立 state，每秒只重渲 StatusBar
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const currentTokens = currentRoundUsage.input + currentRoundUsage.output;
  const lastRound = rounds[rounds.length - 1];
  const ctxTokens = lastRound ? (lastRound.total ?? (lastRound.input + lastRound.output)) : currentTokens;
  const ctxPct = maxContext > 0 ? Math.min(1, ctxTokens / maxContext) : 0;
  const barColor = ctxPct > 0.8 ? t.err : ctxPct > 0.5 ? t.warn : t.accent;
  const cacheAvg = cacheHistory.length > 0
    ? Math.round((cacheHistory.reduce((a, b) => a + b, 0) / cacheHistory.length) * 100)
    : null;

  // 响应式裁剪：窄列下隐藏次要元素，避免溢出覆盖对话区
  const w = term.cols;
  const showChannel = w >= 60;
  const showThinking = w >= 70;
  const showSparkline = w >= 90;
  const showCache = w >= 100;
  const showModel = w >= 80;
  const barWidth = w < 50 ? 4 : w < 70 ? 6 : 8;
  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  const modelStr = `${provider}/${model || "?"}`;
  // model 截断更激进，确保状态栏单行不换行
  const modelMax = w < 90 ? 14 : w < 110 ? 20 : 28;
  const modelShort = truncate(modelStr, modelMax);

  return (
    <Box justifyContent="space-between" paddingX={1} flexShrink={0} height={1} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={streaming ? t.err : t.dim} bold>{streaming ? "REC ● " : "○ "}</Text>
        <Text color={t.dim}>{timecode(now)} </Text>
        {showChannel && <Text color={t.dim}>{channel(round || 0)} </Text>}
        <Text color={t.accent} bold>▌ {agentName} </Text>
        {showThinking && <Text color={t.muted}>{thinkingLabel(thinkingLevel)} </Text>}
      </Box>
      <Box flexShrink={0}>
        <Text color={t.dim}>{compact(ctxTokens)}/{compact(maxContext)} </Text>
        <Text color={barColor}>{bar(ctxPct, barWidth)} </Text>
        <Text color={t.dim}> {Math.round(ctxPct * 100)}% </Text>
        {showSparkline && <Sparkline values={rounds.map(r => r.total ?? (r.input + r.output))} width={8} />}
        {showCache && cacheAvg !== null && <Text> <Text color={cacheAvg > 50 ? t.ok : t.warn}>c{cacheAvg}%</Text></Text>}
        {showModel && <Text color={t.dim}> {modelShort}</Text>}
      </Box>
    </Box>
  );
}
