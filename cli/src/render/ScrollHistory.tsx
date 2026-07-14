/**
 * ScrollHistory —— 对话滚动 + 历史窗口
 *
 * 滚动：fromBottom（0=贴底），总高 = Yoga 实测 contentH（整窗挂载）
 * 历史窗：
 *   - 贴底 / 回底：只渲染最近 HISTORY_BASE(200) 条
 *   - 滚到当前窗顶后再上滚 HISTORY_OVERSCROLL(5) 格：再加载 HISTORY_CHUNK(100)
 *   - 再回底：自动收回 200
 *
 * 测高：useBoxSize（只跟 width/height）。禁止 Ink useBoxMetrics——
 * 它会因滚动时 top 漂移对子树批量 setState → React #185。
 * 200 窗 + 工具卡折叠压挂载量。
 */

import React, { useRef, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useClickTarget, getElementRect } from "../input/click-target.js";
import { useBoxSize } from "../hooks/useBoxSize.js";
import { MessageRow } from "./messages/MessageRow.js";
import { SystemEventRow } from "./messages/SystemEventRow.js";
import type { ChatMessage, SystemEvent } from "../state/types.js";
import { repairUtf8Mojibake } from "../input/filtered-stdin.js";
import { GallerySplash } from "../gallery/GallerySplash.js";
import { maxScrollOf, scrollThumb } from "./chat-scroll.js";
import {
  HISTORY_BASE_ROUNDS,
  HISTORY_CHUNK_ROUNDS,
  HISTORY_OVERSCROLL_NOTCHES,
} from "../config/ui-constants.js";

type Item =
  | { type: "msg"; ts: number; id: string; data: ChatMessage }
  | { type: "sys"; ts: number; id: string; data: SystemEvent };

const BOTTOM_PAD = 4;

export function ScrollHistory({ frame }: { frame: number }) {
  const t = useTheme();
  const messages = useStore((s) => s.messages);
  const systemEvents = useStore((s) => s.systemEvents);
  const gallerySeed = useStore((s) => s.gallerySeed);
  const streaming = useStore((s) => s.streaming);
  const fromBottomStore = useStore((s) => s.chatScrollOffset);
  const maxChatScrollStore = useStore((s) => s.maxChatScroll);
  const autoFollow = useStore((s) => s.autoFollow);
  const scrollActive = useStore((s) => s.scrollActive);
  const chatHistoryStart = useStore((s) => s.chatHistoryStart);
  const setChatHistoryStart = useStore((s) => s.setChatHistoryStart);
  const term = useTerminalSize();

  const rootRef = useRef<DOMElement | null>(null);
  const viewportRef = useRef<DOMElement | null>(null);
  const contentRef = useRef<DOMElement | null>(null);

  const olderBtnRef = useRef<DOMElement | null>(null);
  const olderJumpRef = useRef<() => void>(() => {});
  useClickTarget(olderBtnRef, () => olderJumpRef.current(), []);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [
      ...messages.map((m) => ({ type: "msg" as const, ts: m.ts, id: m.id, data: m })),
      ...systemEvents.map((e) => ({ type: "sys" as const, ts: e.ts, id: e.id, data: e })),
    ];
    out.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    return out;
  }, [messages, systemEvents]);

  const n = items.length;
  const baseStart = Math.max(0, n - HISTORY_BASE_ROUNDS);

  // chatHistoryStart < 0 或贴底 → 收成最近 200；否则用 store（过滚加载会减小）
  const historyStart = useMemo(() => {
    if (n === 0) return 0;
    if (autoFollow || chatHistoryStart < 0) return baseStart;
    return Math.max(0, Math.min(baseStart, chatHistoryStart));
  }, [n, baseStart, chatHistoryStart, autoFollow]);

  // 贴底 / 收窗(-1) → 同步 baseStart；过滚负值 → 解析为上一起点 - CHUNK
  const resolvedStartRef = useRef(historyStart);
  useEffect(() => {
    if (autoFollow || chatHistoryStart === -1) {
      if (chatHistoryStart !== baseStart) setChatHistoryStart(baseStart);
      resolvedStartRef.current = baseStart;
      return;
    }
    if (chatHistoryStart < 0) {
      const from = resolvedStartRef.current;
      const next = Math.max(0, from - HISTORY_CHUNK_ROUNDS);
      setChatHistoryStart(next);
      resolvedStartRef.current = next;
      return;
    }
    if (chatHistoryStart < resolvedStartRef.current) {
      resolvedStartRef.current = chatHistoryStart;
    } else if (chatHistoryStart > baseStart) {
      setChatHistoryStart(baseStart);
      resolvedStartRef.current = baseStart;
    } else {
      resolvedStartRef.current = chatHistoryStart;
    }
  }, [autoFollow, baseStart, chatHistoryStart, setChatHistoryStart]);

  const windowed = useMemo(
    () => items.slice(historyStart),
    [items, historyStart],
  );

  const foldedCount = historyStart;
  const canLoadMore = historyStart > 0;

  // 内容变多/变宽/卡片展开时补测；滚动只改 marginTop，height 不变 → 不 setState
  const contentSize = useBoxSize(contentRef, [
    windowed.length,
    historyStart,
    term.cols,
    term.rows,
    streaming,
    messages.length,
    // ToolCard expandShift 会改 max；借此触发一次高度重读
    maxChatScrollStore,
  ]);
  const viewportSize = useBoxSize(viewportRef, [term.cols, term.rows, windowed.length]);

  const viewH = Math.max(
    4,
    Math.round(viewportSize.height || 0) || Math.max(4, term.rows - 12),
  );
  const contentH = Math.max(0, Math.round(contentSize.height || 0));
  const maxS = maxScrollOf(contentH, viewH);
  const fb = autoFollow ? 0 : Math.max(0, Math.min(fromBottomStore, maxS));
  const mt = contentH > viewH ? -(contentH - viewH - fb) : 0;

  const prevContentHRef = useRef(0);
  const prevHistoryStartRef = useRef(historyStart);
  useEffect(() => {
    const prevH = prevContentHRef.current;
    const prevHs = prevHistoryStartRef.current;
    prevContentHRef.current = contentH;
    prevHistoryStartRef.current = historyStart;
    const store = useStore.getState();

    if (store.autoFollow) {
      if (store.maxChatScroll !== maxS || store.chatScrollOffset !== 0) {
        store.setChatScrollLayout(maxS, 0);
      }
      return;
    }

    // 加载更早：内容在上方变长 → pin-content
    if (historyStart < prevHs && contentH > prevH && prevH > 0) {
      store.setMaxChatScroll(maxS, "pin-content");
      return;
    }

    if (prevH <= 0 || contentH === prevH) {
      if (store.maxChatScroll !== maxS) store.setMaxChatScroll(maxS, "pin-offset");
      else if (store.chatScrollOffset > maxS) store.setChatScrollLayout(maxS, maxS);
      return;
    }

    // 高度变化：钉 fromBottom，避免跳格
    const nextFb = Math.max(0, Math.min(maxS, store.chatScrollOffset));
    store.setChatScrollLayout(maxS, nextFb);
  }, [contentH, maxS, viewH, autoFollow, windowed.length, historyStart]);

  // 视口屏幕矩形与滚动偏移无关：勿依赖 fb，否则每滚一格 setChatViewport → 二次全树重渲
  useEffect(() => {
    if (scrollActive) return;
    const measure = () => {
      const r =
        getElementRect(viewportRef.current) ?? getElementRect(rootRef.current);
      if (!r || r.height <= 0) return;
      useStore.getState().setChatViewport({
        top: r.top,
        bottom: r.top + r.height - 1,
        height: r.height,
      });
    };
    measure();
    const id = setTimeout(measure, 50);
    return () => clearTimeout(id);
  }, [viewH, term.rows, term.cols, windowed.length, contentH, scrollActive]);

  // 滚动中跳过：扫 child yoga 很贵，且每格 fb 都会重算
  const olderUser = useMemo(() => {
    if (scrollActive || fb <= 0 || windowed.length === 0) return null;
    const el = contentRef.current;
    if (!el?.childNodes?.length) {
      const users = windowed.filter(
        (it): it is Item & { type: "msg" } =>
          it.type === "msg" && it.data.role === "user",
      );
      return users.length >= 2 ? users[users.length - 2]! : null;
    }
    const topY = contentH > viewH ? contentH - viewH - fb : 0;
    let last: (Item & { type: "msg" }) | null = null;
    const count = Math.min(windowed.length, el.childNodes.length);
    for (let i = 0; i < count; i++) {
      const child = el.childNodes[i] as DOMElement | undefined;
      const lay = child?.yogaNode?.getComputedLayout?.();
      if (!lay) continue;
      if (Math.round(lay.top + lay.height) > topY + 0.5) break;
      const it = windowed[i]!;
      if (it.type === "msg" && it.data.role === "user") last = it;
    }
    return last;
  }, [fb, windowed, contentH, viewH, scrollActive]);

  olderJumpRef.current = () => {
    if (!olderUser) return;
    const el = contentRef.current;
    const idx = windowed.findIndex((it) => it.id === olderUser.id);
    if (idx < 0 || !el?.childNodes) return;
    const child = el.childNodes[idx] as DOMElement | undefined;
    const top = Math.round(child?.yogaNode?.getComputedLayout?.()?.top ?? 0);
    const newFb = Math.max(0, Math.min(maxS, contentH - viewH - top));
    useStore.getState().setAutoFollow(false);
    useStore.getState().setChatScrollLayout(maxS, newFb);
  };

  const innerW = Math.max(16, term.cols - 2);
  const showRail = maxS > 0 && viewH >= 4;
  const chatW = showRail ? Math.max(8, innerW - 1) : innerW;
  const olderLine = olderUser
    ? fitPrefixLine("↑ ", userPreviewBody(olderUser.data.content ?? ""), innerW)
    : "";

  const atTop = !autoFollow && fb >= maxS && maxS >= 0;
  const topHint = atTop
    ? canLoadMore
      ? `↑ 已到本窗顶部 · 再上滚 ${HISTORY_OVERSCROLL_NOTCHES} 格加载更早 ${HISTORY_CHUNK_ROUNDS} 条（已折叠 ${foldedCount}）`
      : `↑ 已到最早消息`
    : foldedCount > 0 && fb > 0
      ? `… 更早 ${foldedCount} 条已折叠`
      : "";

  if (messages.length === 0 && !streaming) {
    return (
      <Box ref={rootRef} flexGrow={1} width={innerW} flexDirection="column" overflow="hidden">
        <GallerySplash
          seed={gallerySeed || "boot"}
          contentCols={innerW}
          contentRows={Math.max(12, viewH)}
        />
      </Box>
    );
  }

  return (
    <Box ref={rootRef} flexDirection="column" flexGrow={1} width={innerW} overflow="hidden">
      {topHint ? (
        <Box flexShrink={0} width={innerW} overflow="hidden">
          <Text color={t.dim}>{fitPrefixLine("", topHint, innerW)}</Text>
        </Box>
      ) : olderUser && fb > 0 ? (
        <Box ref={olderBtnRef} flexShrink={0} width={innerW} overflow="hidden">
          <Text backgroundColor={t.userBg} color={t.user} bold>
            {olderLine || "↑ (上一条)"}
          </Text>
        </Box>
      ) : null}

      <Box flexGrow={1} flexDirection="row" width={innerW} overflow="hidden">
        <Box
          ref={viewportRef}
          flexGrow={1}
          width={chatW}
          overflow="hidden"
          flexDirection="column"
        >
          <Box
            ref={contentRef}
            flexShrink={0}
            marginTop={mt}
            flexDirection="column"
            width={chatW}
          >
            {windowed.map((it) =>
              it.type === "msg" ? (
                <MessageRow key={`m${it.id}`} msg={it.data} frame={frame} />
              ) : (
                <SystemEventRow key={`s${it.id}`} ev={it.data} />
              ),
            )}
            <Box height={BOTTOM_PAD} flexShrink={0} width={chatW}>
              <Text>{" "}</Text>
            </Box>
          </Box>
        </Box>

        {showRail ? (
          <ScrollRail
            height={viewH}
            fromBottom={fb}
            maxScroll={maxS}
            trackColor={t.borderMuted ?? t.dim}
            thumbColor={t.accent2 ?? t.accent}
          />
        ) : null}
      </Box>
    </Box>
  );
}

function ScrollRail({
  height,
  fromBottom,
  maxScroll,
  trackColor,
  thumbColor,
}: {
  height: number;
  fromBottom: number;
  maxScroll: number;
  trackColor: string;
  thumbColor: string;
}) {
  const { thumbTop, thumbH } = scrollThumb(fromBottom, maxScroll, height);
  const h = Math.max(3, height);
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < h; i++) {
    const on = i >= thumbTop && i < thumbTop + thumbH;
    lines.push(
      <Text key={i} color={on ? thumbColor : trackColor}>
        {on ? "█" : "│"}
      </Text>,
    );
  }
  return (
    <Box flexDirection="column" width={1} flexShrink={0} height={h} overflow="hidden">
      {lines}
    </Box>
  );
}

function userPreviewBody(content: string): string {
  const raw = repairUtf8Mojibake(content || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n/g, " ")
    .trim();
  return raw || "(空消息)";
}

function fitPrefixLine(prefix: string, body: string, targetW: number): string {
  const maxBodyW = Math.max(4, targetW - stringWidth(prefix));
  let out = "";
  let used = 0;
  for (const ch of body) {
    const w = stringWidth(ch) || 1;
    if (used + w > maxBodyW) {
      while (out && stringWidth(out) + 1 > maxBodyW) {
        out = [...out].slice(0, -1).join("");
      }
      out += "…";
      break;
    }
    out += ch;
    used += w;
  }
  const line = `${prefix}${out}`;
  return line + " ".repeat(Math.max(0, targetW - stringWidth(line)));
}
