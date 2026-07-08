/**
 * NavBar —— 导航栏（UI 最底部）+ 信息栏（倒数第二行）。
 *
 * 信息栏（InfoBar）：token/maxContext + bar + pct% + model
 * 导航栏（NavBar）：agent | 后台任务 | 任务 | 会话 | 收件箱[N] | 公告[N] | 设置
 *   每项均分宽度铺满整行，高饱和背景色，hover 变浅，鼠标点击触发 overlay
 */

import React, { useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { compact, bar } from "../layout/decorators.js";
import { useClickTarget } from "../input/click-target.js";

/** 信息栏：上下文占用 + model，倒数第二行 */
export function InfoBar() {
  const t = useTheme();
  const term = useTerminalSize();
  const { provider, model, maxContext, rounds, currentRoundUsage } = useStore();

  const currentTokens = currentRoundUsage.input + currentRoundUsage.output;
  const lastRound = rounds[rounds.length - 1];
  const ctxTokens = lastRound ? (lastRound.total ?? (lastRound.input + lastRound.output)) : currentTokens;
  const ctxPct = maxContext > 0 ? Math.min(1, ctxTokens / maxContext) : 0;
  const barColor = ctxPct > 0.8 ? t.err : ctxPct > 0.5 ? t.warn : t.accent;

  const w = term.cols;
  const barWidth = w < 50 ? 4 : w < 70 ? 6 : 8;

  return (
    <Box flexShrink={0} height={1} justifyContent="space-between">
      <Box flexShrink={0}>
        <Text color={t.dim}>{` ${compact(ctxTokens)}/${compact(maxContext)} `}</Text>
        <Text color={barColor}>{bar(ctxPct, barWidth)}</Text>
        <Text color={t.dim}>{` ${Math.round(ctxPct * 100)}%`}</Text>
      </Box>
      {w >= 80 && <Text color={t.dim}>{`${provider}/${model || "?"}`}</Text>}
    </Box>
  );
}

interface NavItem {
  id: string;
  label: string;
  short: string;
  badge?: number;
  bg: string;
  bgHover: string;   // 悬浮变浅的背景色
  fg: string;
  action: () => void;
}

/** 导航栏：按键行，最底部。均分铺满整行 */
export function NavBar() {
  const t = useTheme();
  const { agentName } = useStore();

  const items: NavItem[] = [
    { id: "agent", label: agentName || "agent", short: agentName?.[0] || "A", bg: t.accent, bgHover: t.accent2, fg: "#000", action: () => useStore.getState().setOverlay("agents") },
    { id: "tasks", label: "后台任务", short: "任", bg: t.warn, bgHover: t.ok, fg: "#000", action: () => useStore.getState().setOverlay("command") },
    { id: "todo", label: "任务", short: "务", bg: t.info, bgHover: t.accent2, fg: "#000", action: () => useStore.getState().setOverlay("command") },
    { id: "sessions", label: "会话", short: "会", bg: t.muted, bgHover: t.dim, fg: t.fg, action: () => useStore.getState().setOverlay("sessions") },
    { id: "inbox", label: "收件箱", short: "收", badge: 0, bg: t.ok, bgHover: t.accent, fg: "#000", action: () => {} },
    { id: "notice", label: "公告", short: "告", badge: 0, bg: t.err, bgHover: t.warn, fg: "#000", action: () => {} },
    { id: "settings", label: "设置", short: "设", bg: t.dim, bgHover: t.muted, fg: t.fg, action: () => useStore.getState().setOverlay("settings") },
  ];

  return (
    <Box flexShrink={0} height={1} width="100%">
      {items.map(it => <NavButton key={it.id} item={it} />)}
    </Box>
  );
}

function NavButton({ item }: { item: NavItem }) {
  const ref = useRef<DOMElement | null>(null);
  useClickTarget(ref, item.action, [item.id]);
  const badgeStr = item.badge && item.badge > 0 ? `[${item.badge}]` : "";
  const fullText = badgeStr ? `${item.label} ${badgeStr}` : item.label;
  // 不做 hover 反色：vram-layer 已移除全局 hover 伪光标（点击位置残留反色块的问题）。
  // hover 高亮若需要，应由各组件用 React 状态自管（后续）。
  return (
    <Box ref={ref} flexGrow={1} flexShrink={1} backgroundColor={item.bg} justifyContent="center">
      <Text backgroundColor={item.bg} color={item.fg} bold wrap="truncate">{fullText}</Text>
    </Box>
  );
}
