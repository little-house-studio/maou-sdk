/**
 * ScrollHistory —— 行级平滑滚动 + 自动跟随底部（网页感）。
 *
 * offset 语义：0 = 看最新（底部），增大 = 向上看更早。
 * marginTop = -(maxScroll - offset)
 *   offset=0        → mt=-maxScroll → 视口顶对应 contentY = maxScroll
 *   offset=maxScroll → mt=0          → 视口顶对应 contentY = 0
 *
 * 因此：contentYAtViewportTop = maxScroll - offset
 * 跳到消息 y：offset = maxScroll - y
 *
 * 顶部 ↑ 预览：视口上方最近一条「完全不可见」的 user 消息缩写；
 * 点击后把该消息起点对齐到聊天区顶（与预览条同屏位置），流畅重合。
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { Box, Text, useBoxMetrics } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useClickTarget, getElementRect } from "../input/click-target.js";
import { MessageRow } from "./messages/MessageRow.js";
import { SystemEventRow } from "./messages/SystemEventRow.js";
import type { ChatMessage, SystemEvent } from "../state/types.js";
import { repairUtf8Mojibake } from "../input/filtered-stdin.js";

type Item =
  | { type: "msg"; ts: number; id: string; data: ChatMessage }
  | { type: "sys"; ts: number; id: string; data: SystemEvent };

/** 累计 content 子节点高度，返回每项起始 y 与高度；总高度 */
function measureItems(contentEl: DOMElement | null, count: number): {
  starts: number[];
  heights: number[];
  total: number;
} {
  const starts: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (let i = 0; i < count; i++) {
    starts.push(y);
    const child = contentEl?.childNodes?.[i] as DOMElement | undefined;
    const h = Math.max(0, child?.yogaNode?.getComputedLayout?.()?.height ?? 0);
    heights.push(h);
    y += h;
  }
  return { starts, heights, total: y };
}

function hasRealLayout(starts: number[], heights: number[]): boolean {
  if (heights.length === 0) return false;
  // 至少有一项非零高，或 cumulative 递增
  return heights.some((h) => h > 0) || starts.some((s, i) => i > 0 && s > 0);
}

/** 与 MessageRow 用户气泡正文一致的纯文本（预览用） */
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

/**
 * 视口上方最近的 user：完全在 contentTopY 之上（endY <= contentTopY）。
 * 即「当前聊天视口里看不到」的最近一条用户消息。
 */
function findOlderUser(
  items: Item[],
  starts: number[],
  heights: number[],
  contentTopY: number,
): (Item & { type: "msg" }) | null {
  let lastAbove: (Item & { type: "msg" }) | null = null;
  for (let i = 0; i < items.length; i++) {
    const y0 = starts[i] ?? 0;
    const h = heights[i] ?? 0;
    const y1 = y0 + h;
    // 完全在视口顶之上
    if (y1 <= contentTopY + 0.5) {
      const it = items[i]!;
      if (it.type === "msg" && it.data.role === "user") lastAbove = it;
      continue;
    }
    // 第一条与视口相交或更下方的项 —— 其后不可能再「完全在上方」
    break;
  }
  return lastAbove;
}

export function ScrollHistory({ frame }: { frame: number }) {
  const t = useTheme();
  const messages = useStore((s) => s.messages);
  const systemEvents = useStore((s) => s.systemEvents);
  const chatScrollOffset = useStore((s) => s.chatScrollOffset);
  const maxChatScroll = useStore((s) => s.maxChatScroll);
  const autoFollow = useStore((s) => s.autoFollow);
  const setMaxChatScroll = useStore((s) => s.setMaxChatScroll);
  const term = useTerminalSize();

  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const contentMetrics = useBoxMetrics(contentRef);
  const olderBtnRef = useRef<DOMElement | null>(null);
  const olderJumpRef = useRef<() => void>(() => {});
  useClickTarget(olderBtnRef, () => olderJumpRef.current(), []);

  /** 跳转对齐：短暂隐藏 ↑ 条，让目标消息顶到与预览条相同的屏幕行 */
  const [suppressOlderChrome, setSuppressOlderChrome] = useState(false);
  /** 待对齐的消息 id + 期望 contentY（layout 后再精算 offset） */
  const pendingAlignRef = useRef<{ id: string; targetY: number } | null>(null);

  // 合并 messages + systemEvents 按 ts 排序
  const items: Item[] = [
    ...messages.map((m) => ({ type: "msg" as const, ts: m.ts, id: m.id, data: m })),
    ...systemEvents.map((e) => ({ type: "sys" as const, ts: e.ts, id: e.id, data: e })),
  ].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));

  // 先算 offset，再定 chrome / 视口高度
  const rawOffset = Math.min(chatScrollOffset, maxChatScroll);
  const offset = autoFollow ? 0 : rawOffset;
  const hasNewer = offset > 0;
  const hasOlderRoom = offset < maxChatScroll;

  // 视口顶对应的 content Y
  const contentTopY = maxChatScroll - offset;

  const contentEl = contentRef.current as DOMElement | null;
  const measured = measureItems(contentEl, items.length);
  const layoutReady = hasRealLayout(measured.starts, measured.heights);

  const olderUserPreview = (() => {
    if (!hasOlderRoom || items.length === 0 || suppressOlderChrome) return null;
    if (!layoutReady) {
      // 未量到高度：不瞎猜「倒数第二条」；仅在贴底时用「倒数第二条 user」作弱提示
      if (offset === 0 || autoFollow) {
        const users = items.filter(
          (it): it is Item & { type: "msg" } =>
            it.type === "msg" && it.data.role === "user",
        );
        if (users.length >= 2) return users[users.length - 2]!;
        return null;
      }
      return null;
    }
    return findOlderUser(items, measured.starts, measured.heights, contentTopY);
  })();

  const showOlder = hasOlderRoom && !!olderUserPreview && !suppressOlderChrome;
  const chrome = showOlder ? 1 : 0;
  // hasNewer 时 Layout 多 1 行底条
  const availableRows = Math.max(4, term.rows - 6 - chrome - (hasNewer ? 1 : 0));

  const contentHeight = contentMetrics.height;
  useEffect(() => {
    const max = Math.max(0, contentHeight - availableRows);
    setMaxChatScroll(max, /*followGrowth=*/ true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentHeight, availableRows]);

  /**
   * 跳转后二次对齐：↑ 条隐藏 → availableRows+1 → maxScroll 变，
   * 在 suppress 期间用新 layout 重算 offset = max - targetY，
   * 使消息起点落到「原预览条」那一行屏幕位置，再恢复 ↑ 条。
   */
  useEffect(() => {
    if (!suppressOlderChrome) return;
    const pending = pendingAlignRef.current;
    if (!pending) {
      setSuppressOlderChrome(false);
      return;
    }

    let cancelled = false;
    const runAlign = () => {
      if (cancelled) return;
      const el = contentRef.current as DOMElement | null;
      const { starts, heights } = measureItems(el, items.length);
      if (!hasRealLayout(starts, heights)) {
        // 下一帧再试
        requestAnimationFrame(runAlign);
        return;
      }
      const idx = items.findIndex((it) => it.id === pending.id);
      if (idx < 0) {
        pendingAlignRef.current = null;
        setSuppressOlderChrome(false);
        return;
      }
      const targetY = starts[idx] ?? pending.targetY;
      const max = Math.max(0, contentHeight - availableRows);
      useStore.getState().setMaxChatScroll(max, false);
      const nextOffset = Math.max(0, Math.min(max, max - targetY));
      useStore.getState().setAutoFollow(false);
      useStore.getState().setChatScrollOffset(nextOffset);

      // 再等一帧让 Ink 落稳，再露出更早预览
      requestAnimationFrame(() => {
        if (cancelled) return;
        pendingAlignRef.current = null;
        setSuppressOlderChrome(false);
      });
    };

    const id = requestAnimationFrame(runAlign);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [suppressOlderChrome, contentHeight, availableRows, items]);

  // 上报真实消息视口屏幕行
  useEffect(() => {
    const measure = () => {
      const r = getElementRect(viewportRef.current as DOMElement | null);
      if (!r || r.height <= 0) return;
      useStore.getState().setChatViewport({
        top: r.top,
        bottom: r.top + r.height - 1,
        height: r.height,
      });
    };
    measure();
    const id = setTimeout(measure, 30);
    return () => clearTimeout(id);
  }, [availableRows, showOlder, hasNewer, term.rows, offset, contentHeight]);

  // hooks 必须在任何 early return 之前（空消息时也要同序调用）
  const jumpToOlderUser = useCallback(() => {
    if (!olderUserPreview) return;
    const el = contentRef.current as DOMElement | null;
    const { starts: st, heights: ht } = measureItems(el, items.length);
    const idx = items.findIndex((it) => it.id === olderUserPreview.id);
    if (idx < 0) return;

    let targetY = st[idx] ?? 0;
    // 高度未就绪时用均分估算，避免跳到 0
    if (!hasRealLayout(st, ht) && items.length > 0) {
      const approx = Math.max(1, Math.floor(contentHeight / items.length));
      targetY = idx * approx;
    }

    pendingAlignRef.current = { id: olderUserPreview.id, targetY };
    // 先藏 ↑ 条：视口上扩，下一帧 effect 用新 max 把消息顶对齐到「原预览行」
    setSuppressOlderChrome(true);

    const maxNow = useStore.getState().maxChatScroll;
    // 预估 chrome 消失后 max-1
    const maxAfter = Math.max(0, maxNow - 1);
    const nextOffset = Math.max(0, Math.min(maxAfter, maxAfter - targetY));
    useStore.getState().setAutoFollow(false);
    useStore.getState().setChatScrollOffset(nextOffset);
  }, [olderUserPreview, items, contentHeight]);

  olderJumpRef.current = jumpToOlderUser;

  if (messages.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
        <Text color={t.accent} bold>▌ MAOU // 待命</Text>
        <Text color={t.dim}>输入消息开始对话</Text>
        <Text color={t.dim}>Ctrl+K 命令 · Ctrl+E 全屏 · Ctrl+C 退出</Text>
      </Box>
    );
  }

  const marginTop = -(maxChatScroll - offset);

  // 预览行：与用户气泡同灰底；正文与 MessageRow body 一致
  const olderPreviewLine = (() => {
    if (!olderUserPreview || olderUserPreview.type !== "msg") return "";
    const body = userPreviewBody(olderUserPreview.data.content ?? "");
    const prefix = "↑ ";
    const targetW = Math.max(8, term.cols - 2);
    return fitPrefixLine(prefix, body, targetW);
  })();

  return (
    <Box flexDirection="column" flexGrow={1}>
      {showOlder && olderUserPreview && (
        <Box ref={olderBtnRef} flexShrink={0}>
          <Text backgroundColor={t.userBg} color={t.user} bold>
            {olderPreviewLine || "↑ (上一条)"}
          </Text>
        </Box>
      )}
      <Box ref={viewportRef} height={availableRows} overflow="hidden" flexDirection="column">
        <Box ref={contentRef} flexShrink={0} marginTop={marginTop} flexDirection="column">
          {items.map((it) =>
            it.type === "msg" ? (
              <MessageRow key={`m${it.id}`} msg={it.data} frame={frame} />
            ) : (
              <SystemEventRow key={`s${it.id}`} ev={it.data} />
            ),
          )}
        </Box>
      </Box>
    </Box>
  );
}
