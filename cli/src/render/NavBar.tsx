/**
 * NavBar —— 导航栏（UI 最底部）+ 信息栏（倒数第二行）。
 *
 * 信息栏（InfoBar）：token/maxContext + bar + pct% + model
 * 导航栏（NavBar）：等距等宽格 + 文字居中铺满整行
 */

import React, { useRef } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { compact, bar } from "../layout/decorators.js";
import { useClickTarget } from "../input/click-target.js";

/** 信息栏：上下文占用 + model，倒数第二行（坐在 footerBg 白灰上） */
export function InfoBar() {
  const t = useTheme();
  const term = useTerminalSize();
  const provider = useStore((s) => s.provider);
  const model = useStore((s) => s.model);
  const maxContext = useStore((s) => s.maxContext);
  const rounds = useStore((s) => s.rounds);
  const currentRoundUsage = useStore((s) => s.currentRoundUsage);

  const currentTokens = currentRoundUsage.input + currentRoundUsage.output;
  const lastRound = rounds[rounds.length - 1];
  const ctxTokens = lastRound ? (lastRound.total ?? (lastRound.input + lastRound.output)) : currentTokens;
  const ctxPct = maxContext > 0 ? Math.min(1, ctxTokens / maxContext) : 0;
  const barColor = ctxPct > 0.8 ? t.err : ctxPct > 0.5 ? t.warn : t.userBg;
  const ink = "#000000";
  const inkMuted = t.userBg;

  const w = term.cols;
  const barWidth = w < 50 ? 4 : w < 70 ? 6 : 8;

  return (
    <Box flexShrink={0} height={1} width="100%" backgroundColor={t.footerBg} justifyContent="space-between">
      <Box flexShrink={0}>
        <Text backgroundColor={t.footerBg} color={inkMuted}>{` ${compact(ctxTokens)}/${compact(maxContext)} `}</Text>
        <Text backgroundColor={t.footerBg} color={barColor}>{bar(ctxPct, barWidth)}</Text>
        <Text backgroundColor={t.footerBg} color={inkMuted}>{` ${Math.round(ctxPct * 100)}%`}</Text>
      </Box>
      {w >= 80 && (
        <Text backgroundColor={t.footerBg} color={ink}>
          {`${provider}/${model || "?"}`}
        </Text>
      )}
    </Box>
  );
}

interface NavItem {
  id: string;
  label: string;
  short: string;
  badge?: number;
  bg: string;
  bgHover: string;
  fg: string;
  action: () => void;
}

/** 在固定宽度内居中文字；过长则截断，必要时退回 short */
function centerInWidth(text: string, short: string, width: number): string {
  if (width <= 0) return "";
  let label = text;
  if (stringWidth(label) > width) {
    label = short;
  }
  if (stringWidth(label) > width) {
    // 再截
    let out = "";
    let used = 0;
    for (const ch of label) {
      const cw = stringWidth(ch) || 1;
      if (used + cw > width) break;
      out += ch;
      used += cw;
    }
    label = out || "·";
  }
  const tw = stringWidth(label);
  const pad = Math.max(0, width - tw);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return " ".repeat(left) + label + " ".repeat(right);
}

/** 导航栏：等距等宽 + 文字居中 */
export function NavBar() {
  const t = useTheme();
  const term = useTerminalSize();
  const agentName = useStore((s) => s.agentName);

  const items: NavItem[] = [
    { id: "agent", label: agentName || "agent", short: agentName?.[0] || "A", bg: t.accent, bgHover: t.accent2, fg: "#000", action: () => useStore.getState().setOverlay("agents") },
    { id: "tasks", label: "后台任务", short: "任", bg: t.warn, bgHover: t.ok, fg: "#000", action: () => useStore.getState().setOverlay("command") },
    { id: "todo", label: "任务", short: "务", bg: t.info, bgHover: t.accent2, fg: "#FFFFFF", action: () => useStore.getState().setOverlay("command") },
    { id: "sessions", label: "会话", short: "会", bg: t.userBg, bgHover: t.muted, fg: "#FFFFFF", action: () => useStore.getState().setOverlay("sessions") },
    { id: "inbox", label: "收件箱", short: "收", badge: 0, bg: t.ok, bgHover: t.accent, fg: "#000", action: () => {} },
    { id: "notice", label: "公告", short: "告", badge: 0, bg: t.err, bgHover: t.warn, fg: "#000", action: () => {} },
    { id: "settings", label: "设置", short: "设", bg: t.userBg, bgHover: t.muted, fg: "#C5C5C5", action: () => useStore.getState().setOverlay("settings") },
  ];

  const n = items.length;
  const cols = Math.max(n, term.cols);
  const base = Math.floor(cols / n);
  const rem = cols - base * n; // 前 rem 个格多 1 列，保证铺满且尽量均分

  return (
    <Box flexShrink={0} height={1} width="100%" backgroundColor={t.footerBg}>
      {items.map((it, i) => (
        <NavButton
          key={it.id}
          item={it}
          width={base + (i < rem ? 1 : 0)}
        />
      ))}
    </Box>
  );
}

function NavButton({ item, width }: { item: NavItem; width: number }) {
  const ref = useRef<DOMElement | null>(null);
  const id = useClickTarget(ref, item.action, [item.id]);
  const hoverId = useStore((s) => s.hoverId);
  const isHover = hoverId === id;
  const bg = isHover ? item.bgHover : item.bg;
  const badgeStr = item.badge && item.badge > 0 ? `[${item.badge}]` : "";
  const fullText = badgeStr ? `${item.label}${badgeStr}` : item.label;
  const shortText = badgeStr ? `${item.short}${badgeStr}` : item.short;
  const line = centerInWidth(fullText, shortText, width);

  return (
    <Box ref={ref} width={width} flexShrink={0} backgroundColor={bg}>
      <Text backgroundColor={bg} color={item.fg} bold>
        {line}
      </Text>
    </Box>
  );
}
