/**
 * NavBar —— 导航栏（UI 最底部）+ 信息栏（倒数第二行）。
 *
 * 信息栏（InfoBar）：token/maxContext + bar + 近10轮平均缓存命中率 + model
 * 导航栏（NavBar）：等距等宽格 + 文字居中铺满整行
 *
 * 顺序与颜色来自 assets/themes/<name>.json → nav
 * 未写 bgHover 时用主题 defaults.hover 自动提亮
 */

import React, { useRef, useMemo } from "react";
import { Box, Text, Transform } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme, useThemeNav } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { compact } from "../layout/decorators.js";
import { useClickTarget } from "../input/click-target.js";
import { makeClickableTransform } from "../input/osc8-link.js";
import { TERM_BREAKPOINTS } from "../config/ui-constants.js";
import { formatCacheLabel } from "../lib/prompt-cache.js";

/** 信息栏：上下文占用 + 近10轮主模型缓存命中 + model */
export function InfoBar() {
  const t = useTheme();
  const term = useTerminalSize();
  const provider = useStore((s) => s.provider);
  const model = useStore((s) => s.model);
  const maxContext = useStore((s) => s.maxContext);
  const rounds = useStore((s) => s.rounds);
  const currentRoundUsage = useStore((s) => s.currentRoundUsage);
  const cacheHistory = useStore((s) => s.cacheHistory);

  const currentTokens = currentRoundUsage.input + currentRoundUsage.output;
  const lastRound = rounds[rounds.length - 1];
  const ctxTokens = lastRound
    ? (lastRound.total ?? lastRound.input + lastRound.output)
    : currentTokens;
  const usedPct = maxContext > 0 ? Math.min(1.2, ctxTokens / maxContext) : 0;
  // 仅当前主 agent 主模型；无 cache 能力的模型（xopqwen 等）显示 c— 而非假 c0%
  const { label: cacheLabel, pct: cacheAvg, eligible: cacheEligible } = formatCacheLabel(
    model,
    provider,
    cacheHistory,
    10,
  );
  let fillColor: string;
  if (usedPct >= 0.7) fillColor = t.err;
  else if (usedPct >= 0.5) fillColor = t.warn;
  else fillColor = t.ok ?? t.accent;
  const emptyColor = "#000000";
  const ink = "#000000";
  // 缓存命中着色：仅对支持上报的模型；高=绿、中=黄、低=橙红
  let cacheColor = ink;
  if (cacheEligible && cacheAvg !== null) {
    if (cacheAvg >= 50) cacheColor = t.ok ?? t.accent;
    else if (cacheAvg >= 20) cacheColor = t.warn;
    else cacheColor = t.err;
  }

  const w = term.cols;
  const barWidth = w < 50 ? 4 : w < 70 ? 6 : 8;
  const filled = Math.round(Math.min(1, usedPct) * barWidth);
  const empty = Math.max(0, barWidth - filled);

  return (
    <Box
      flexShrink={0}
      height={1}
      width="100%"
      backgroundColor={t.footerBg}
      justifyContent="space-between"
    >
      <Box flexShrink={0}>
        <Text backgroundColor={t.footerBg} color={ink}>{` ${compact(ctxTokens)}/${compact(maxContext)} `}</Text>
        <Text backgroundColor={t.footerBg} color={fillColor}>{`${"█".repeat(filled)}`}</Text>
        <Text backgroundColor={t.footerBg} color={emptyColor}>{`${"░".repeat(empty)}`}</Text>
        <Text backgroundColor={t.footerBg} color={cacheColor} bold={cacheEligible && cacheAvg !== null}>
          {cacheLabel}
        </Text>
      </Box>
      {w >= TERM_BREAKPOINTS.showModelMin && (
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
  fgHover: string;
  action: () => void;
}

function centerInWidth(text: string, short: string, width: number): string {
  if (width <= 0) return "";
  let label = text;
  if (stringWidth(label) > width) label = short;
  if (stringWidth(label) > width) {
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

const NAV_ACTIONS: Record<string, () => void> = {
  agent: () => useStore.getState().setOverlay("agents"),
  terminal: () => useStore.getState().setOverlay("command"),
  todo: () => useStore.getState().setOverlay("command"),
  sessions: () => useStore.getState().setOverlay("sessions"),
  inbox: () => {},
  notice: () => {},
  settings: () => useStore.getState().setOverlay("settings"),
};

/** 导航栏：顺序/颜色来自当前主题 nav */
export function NavBar() {
  const t = useTheme();
  const term = useTerminalSize();
  const nav = useThemeNav();

  const items: NavItem[] = useMemo(() => {
    const out: NavItem[] = [];
    for (const id of nav.order) {
      const cfg = nav.items[id];
      if (!cfg) continue;
      out.push({
        id,
        label: cfg.label,
        short: cfg.short,
        badge: cfg.badge,
        bg: cfg.bg,
        bgHover: cfg.bgHover,
        fg: cfg.fg,
        fgHover: cfg.fgHover ?? cfg.fg,
        action: NAV_ACTIONS[id] ?? (() => {}),
      });
    }
    return out;
  }, [nav]);

  const n = items.length;
  const cols = Math.max(n, term.cols);
  const base = Math.floor(cols / n);
  const rem = cols - base * n;

  return (
    <Box flexShrink={0} height={1} width="100%" backgroundColor={t.footerBg}>
      {items.map((it, i) => (
        <NavButton key={it.id} item={it} width={base + (i < rem ? 1 : 0)} />
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
  const fg = isHover ? item.fgHover : item.fg;
  const badgeStr = item.badge && item.badge > 0 ? `[${item.badge}]` : "";
  const fullText = badgeStr ? `${item.label}${badgeStr}` : item.label;
  const shortText = badgeStr ? `${item.short}${badgeStr}` : item.short;
  const line = centerInWidth(fullText, shortText, width);
  const linkTransform = React.useMemo(
    () => makeClickableTransform(`nav/${item.id}`),
    [item.id],
  );

  return (
    <Box ref={ref} width={width} flexShrink={0} backgroundColor={bg}>
      <Transform transform={linkTransform}>
        <Text backgroundColor={bg} color={fg} bold>
          {line}
        </Text>
      </Transform>
    </Box>
  );
}
