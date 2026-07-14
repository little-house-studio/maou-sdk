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
import { timecode, channel, thinkingLabel, compact, bar, truncate } from "../layout/decorators.js";
import { Sparkline } from "./sparkline.js";
import { useAnimFrame, spinnerChar, neonRgb } from "../hooks/useAnimFrame.js";
import { TERM_BREAKPOINTS } from "../config/ui-constants.js";
import { formatCacheLabel } from "../lib/prompt-cache.js";

export function StatusBar() {
  const t = useTheme();
  // 细粒度 selector，避免每个 stream delta 重渲整栏
  const streaming = useStore((s) => s.streaming);
  const recFrame = useAnimFrame(streaming, 200);
  const agentName = useStore((s) => s.agentName);
  const provider = useStore((s) => s.provider);
  const model = useStore((s) => s.model);
  const maxContext = useStore((s) => s.maxContext);
  const round = useStore((s) => s.round);
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const rounds = useStore((s) => s.rounds);
  const cacheHistory = useStore((s) => s.cacheHistory);
  const currentRoundUsage = useStore((s) => s.currentRoundUsage);
  const term = useTerminalSize();
  const [now, setNow] = useState(() => new Date());

  // 时码：1s tick 只改 StatusBar；vram 侧有行 diff，不再因此整屏重刷。
  // 未 streaming 时降到 2s，进一步砍空闲 setState。
  useEffect(() => {
    const ms = streaming ? 1000 : 2000;
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [streaming]);

  const currentTokens = currentRoundUsage.input + currentRoundUsage.output;
  const lastRound = rounds[rounds.length - 1];
  const ctxTokens = lastRound ? (lastRound.total ?? (lastRound.input + lastRound.output)) : currentTokens;
  const ctxPct = maxContext > 0 ? Math.min(1, ctxTokens / maxContext) : 0;
  const barColor = ctxPct > 0.8 ? t.err : ctxPct > 0.5 ? t.warn : t.accent;
  // 仅当前主 agent 主模型的合并缓存率；无 cache 能力模型 → c—
  const { label: cacheLabel, pct: cacheAvg } = formatCacheLabel(
    model,
    provider,
    cacheHistory,
    10,
  );

  // 响应式裁剪：窄列下隐藏次要元素，避免溢出覆盖对话区
  const w = term.cols;
  const showChannel = w >= 60;
  const showThinking = w >= 70;
  const showSparkline = w >= 90;
  const showCache = w >= TERM_BREAKPOINTS.showCacheMin;
  const showModel = w >= TERM_BREAKPOINTS.showModelMin;
  const barWidth = w < 50 ? 4 : w < 70 ? 6 : 8;
  const modelStr = `${provider}/${model || "?"}`;
  // model 截断更激进，确保状态栏单行不换行
  const modelMax = w < 90 ? 14 : w < 110 ? 20 : 28;
  const modelShort = truncate(modelStr, modelMax);

  const recPulse = neonRgb(recFrame * 0.7);
  const recHex = `#${recPulse.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  // REC 灯闪：偶帧亮酸色 / 奇帧暗红
  const recOn = recFrame % 2 === 0;

  return (
    <Box justifyContent="space-between" paddingX={1} flexShrink={0} height={1} overflow="hidden">
      <Box flexShrink={0}>
        {streaming ? (
          <Text color={recOn ? recHex : t.err} bold>
            {`${spinnerChar(recFrame)} REC ${recOn ? "●" : "○"} `}
          </Text>
        ) : (
          <Text color={t.dim} bold>{"○ "}</Text>
        )}
        <Text color={t.dim}>{timecode(now)} </Text>
        {showChannel && <Text color={t.dim}>{channel(round || 0)} </Text>}
        <Text color={streaming ? recHex : t.accent} bold>▌ {agentName} </Text>
        {showThinking && <Text color={t.muted}>{thinkingLabel(thinkingLevel)} </Text>}
      </Box>
      <Box flexShrink={0}>
        <Text color={t.dim}>{compact(ctxTokens)}/{compact(maxContext)} </Text>
        <Text color={barColor}>{bar(ctxPct, barWidth)} </Text>
        <Text color={t.dim}> {Math.round(ctxPct * 100)}% </Text>
        {showSparkline && <Sparkline values={rounds.map(r => r.total ?? (r.input + r.output))} width={8} />}
        {showCache && cacheAvg !== null && (
          <Text>
            {" "}
            <Text color={cacheAvg > 50 ? t.ok : t.warn}>{cacheLabel.trim()}</Text>
          </Text>
        )}
        {showModel && <Text color={t.dim}> {modelShort}</Text>}
      </Box>
    </Box>
  );
}
