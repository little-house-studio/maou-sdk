/**
 * ScrollHistory —— 对话滚动 + 历史窗口 + 视口虚拟化（Grok scrollback 思路）
 *
 * 坐标系：fromBottom（0=贴底），totalH = 高度缓存之和（非整树 Yoga 实测）。
 * 虚拟化：只挂载可见条目 ± buffer；上下用 height spacer 占位。
 *   → 滚动时 Yoga 节点数 ≈ 视口行数，而非整窗 200 条消息。
 * 关闭：MAOU_VIRTUAL_SCROLL=0
 *
 * 历史窗（仍保留）：
 *   - 贴底：最近 HISTORY_BASE
 *   - 顶缘过滚：再加载 CHUNK
 *
 * 测高：MeasuredBlock + useBoxSize；禁止 Ink useBoxMetrics（#185）。
 *
 * 功能取舍（可接受）：
 *   - 未测块用估算高，首次滚入可能轻微跳 1～2 行
 *   - 选区/点击仅对已挂载块有效（屏外本就不可见）
 *   - 「上一条用户」用缓存坐标跳转，不再扫整树 child yoga
 */

import React, { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import stringWidth from "string-width";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useClickTarget, getElementRect } from "../input/click-target.js";
import { useBoxSize, readContentHeight } from "../hooks/useBoxSize.js";
import { MessageRow } from "./messages/MessageRow.js";
import { SystemEventRow } from "./messages/SystemEventRow.js";
import type { ChatMessage, SystemEvent } from "../state/types.js";
import { repairUtf8Mojibake } from "../input/filtered-stdin.js";
import { GallerySplash } from "../gallery/GallerySplash.js";
import {
  maxScrollOf,
  scrollThumb,
  buildStarts,
  virtualRange,
  topYOf,
} from "./chat-scroll.js";
import {
  HISTORY_BASE_ROUNDS,
  HISTORY_CHUNK_ROUNDS,
  HISTORY_OVERSCROLL_NOTCHES,
} from "../config/ui-constants.js";
import { liteHistoryBase } from "../config/lite-mode.js";
import {
  type ScrollItem,
  type HeightCache,
  resolveHeights,
  virtualScrollEnabled,
  VIRTUAL_BUFFER,
} from "./scrollback-heights.js";
import { MeasuredBlock } from "./MeasuredBlock.js";

type Item = ScrollItem;

/** 贴底只隔一行空白 */
const BOTTOM_PAD = 1;

function measureKeyFor(it: Item, epoch: number): string {
  if (it.type === "sys") return `s:${it.id}:${epoch}`;
  const m = it.data;
  const tools = (m.toolCalls ?? [])
    .map((t) => `${t.id}:${t.done ? 1 : 0}:${(t.result || "").length}`)
    .join(",");
  const thinks = (m.thinkingBlocks ?? []).map((b) => (b.content || "").length).join(",");
  return `m:${it.id}:${(m.content || "").length}:${tools}:${thinks}:${epoch}`;
}

export function ScrollHistory({ frame }: { frame: number }) {
  const t = useTheme();
  const messages = useStore((s) => s.messages);
  const systemEvents = useStore((s) => s.systemEvents);
  const gallerySeed = useStore((s) => s.gallerySeed);
  const streaming = useStore((s) => s.streaming);
  const fromBottomStore = useStore((s) => s.chatScrollOffset);
  const autoFollow = useStore((s) => s.autoFollow);
  const scrollActive = useStore((s) => s.scrollActive);
  const contentLayoutEpoch = useStore((s) => s.contentLayoutEpoch);
  const chatHistoryStart = useStore((s) => s.chatHistoryStart);
  const setChatHistoryStart = useStore((s) => s.setChatHistoryStart);
  const term = useTerminalSize();
  const virtOn = virtualScrollEnabled();

  const rootRef = useRef<DOMElement | null>(null);
  const viewportRef = useRef<DOMElement | null>(null);
  const contentRef = useRef<DOMElement | null>(null);

  const olderBtnRef = useRef<DOMElement | null>(null);
  const olderJumpRef = useRef<() => void>(() => {});
  useClickTarget(olderBtnRef, () => olderJumpRef.current(), []);

  // 高度缓存：跨 render 保持；id 消失时惰性留着也无妨
  const heightCacheRef = useRef<HeightCache>(new Map());
  // 强制在测高后刷新虚拟窗
  const [heightTick, setHeightTick] = useState(0);
  /**
   * 滚动中冻结可见窗（Grok 思路：滚时只改 offset，少 remount）。
   * 仅当视口滑出冻结范围时才扩展 [start,end)。
   */
  const freezeVrRef = useRef<{
    startIdx: number;
    endIdx: number;
    n: number;
  } | null>(null);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [
      ...messages.map((m) => ({ type: "msg" as const, ts: m.ts, id: m.id, data: m })),
      ...systemEvents.map((e) => ({ type: "sys" as const, ts: e.ts, id: e.id, data: e })),
    ];
    out.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    return out;
  }, [messages, systemEvents]);

  const n = items.length;
  const historyCap = liteHistoryBase(HISTORY_BASE_ROUNDS);
  const baseStart = Math.max(0, n - historyCap);

  const historyStart = useMemo(() => {
    if (n === 0) return 0;
    if (autoFollow || chatHistoryStart < 0) return baseStart;
    return Math.max(0, Math.min(baseStart, chatHistoryStart));
  }, [n, baseStart, chatHistoryStart, autoFollow]);

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

  // 视口高度
  const viewportSize = useBoxSize(viewportRef, [term.cols, term.rows, windowed.length]);
  // 非虚拟：仍测整 content 高度（旧路径）
  const contentSize = useBoxSize(contentRef, [
    windowed.length,
    historyStart,
    term.cols,
    term.rows,
    streaming,
    messages.length,
    contentLayoutEpoch,
    virtOn ? 0 : 1,
  ]);
  const viewH = Math.max(
    4,
    Math.round(viewportSize.height || 0) || Math.max(4, term.rows - 12),
  );

  // 高度数组 + 前缀和（虚拟路径用 cache；非虚拟仅用于 olderUser 回退）
  const heights = useMemo(
    () => resolveHeights(windowed, heightCacheRef.current, term.cols),
    // heightTick：测高更新；epoch：折叠/流式
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windowed, term.cols, heightTick, contentLayoutEpoch],
  );
  const { starts, total: itemsTotalH } = useMemo(
    () => buildStarts(heights),
    [heights],
  );
  const measuredFull = useMemo(() => {
    if (virtOn) return 0;
    const env = readContentHeight(contentRef);
    return Math.max(Math.round(contentSize.height || 0), env);
  }, [virtOn, contentSize.height, contentLayoutEpoch, windowed.length, streaming]);

  const rawContentH = virtOn
    ? itemsTotalH + BOTTOM_PAD
    : Math.max(measuredFull, itemsTotalH + BOTTOM_PAD);

  const frozenLayoutRef = useRef({ contentH: 0, viewH: 0 });
  if (!scrollActive) {
    if (rawContentH > 0) frozenLayoutRef.current.contentH = rawContentH;
    if (viewH > 0) frozenLayoutRef.current.viewH = viewH;
  }
  const contentH =
    scrollActive && frozenLayoutRef.current.contentH > 0
      ? frozenLayoutRef.current.contentH
      : rawContentH;
  const viewHStable =
    scrollActive && frozenLayoutRef.current.viewH > 0
      ? frozenLayoutRef.current.viewH
      : viewH;

  const maxS = maxScrollOf(contentH, viewHStable);
  const atBottom = autoFollow || fromBottomStore <= 0;
  const fb = atBottom ? 0 : Math.max(0, Math.min(fromBottomStore, maxS));

  // 虚拟可见窗（滚动中冻结/扩展，减少 remount → 接近 Grok「只改 offset」）
  const vr = useMemo(() => {
    if (!virtOn || windowed.length === 0) {
      freezeVrRef.current = null;
      return {
        startIdx: 0,
        endIdx: windowed.length,
        padTop: 0,
        padBottom: 0,
      };
    }
    // 滚动中加宽 buffer，给 marginTop 滑动留跑道
    const buf = scrollActive
      ? Math.max(VIRTUAL_BUFFER, 8)
      : VIRTUAL_BUFFER;
    const fresh = virtualRange(
      heights,
      starts,
      Math.max(0, contentH - BOTTOM_PAD),
      viewHStable,
      fb,
      buf,
    );

    if (!scrollActive) {
      freezeVrRef.current = null;
      return fresh;
    }

    const fr = freezeVrRef.current;
    if (!fr || fr.n !== windowed.length) {
      freezeVrRef.current = {
        startIdx: fresh.startIdx,
        endIdx: fresh.endIdx,
        n: windowed.length,
      };
      return fresh;
    }

    // 仅当需要的窗超出冻结范围时扩展（不收缩，避免来回 remount）
    const startIdx = Math.min(fr.startIdx, fresh.startIdx);
    const endIdx = Math.max(fr.endIdx, fresh.endIdx);
    freezeVrRef.current = { startIdx, endIdx, n: windowed.length };
    const itemsH = Math.max(0, contentH - BOTTOM_PAD);
    const padTop = starts[startIdx] ?? 0;
    const padBottom =
      endIdx >= windowed.length ? 0 : itemsH - (starts[endIdx] ?? itemsH);
    return { startIdx, endIdx, padTop, padBottom };
  }, [virtOn, windowed.length, heights, starts, contentH, viewHStable, fb, scrollActive]);

  const visible = useMemo(
    () => windowed.slice(vr.startIdx, vr.endIdx),
    [windowed, vr.startIdx, vr.endIdx],
  );

  // 全量挂载时仍用 marginTop；虚拟化时用 padTop spacer + 无需 marginTop 滑动整树
  // 虚拟化：视口固定，内容 = padTop + visible + padBottom + bottomPad
  // 视口显示的是 content 从 y=0 开始… 不对。
  //
  // 正确虚拟列表：
  //   视口裁剪 overflow hidden
  //   内容结构: [padTop spacer][visible items][padBottom spacer][BOTTOM_PAD]
  //   totalH = padTop + visibleHeights + padBottom + BOTTOM_PAD = contentH
  //   marginTop = -(contentH - viewH - fb) 仍适用！
  //   当 padTop = starts[startIdx]，padBottom = total - starts[endIdx]，
  //   整段高度仍等于 itemsTotalH + BOTTOM_PAD，marginTop 与全量挂载一致。

  const mt = contentH > viewHStable ? -(contentH - viewHStable - fb) : 0;

  const onItemHeight = useCallback((id: string, height: number) => {
    const h = Math.max(1, Math.round(height));
    const prev = heightCacheRef.current.get(id);
    if (prev === h) return;
    heightCacheRef.current.set(id, h);
    // 滚动中攒着，松手后 heightTick 会在 scrollActive 变 false 时顺带刷新；
    // 但首次进入也要测，允许滚动中更新 cache 不强制 re-render（下一帧/静止时用）
    if (!useStore.getState().scrollActive) {
      setHeightTick((x) => x + 1);
    }
  }, []);

  // 滚动结束：用最新 cache 重算布局
  useEffect(() => {
    if (scrollActive) return;
    setHeightTick((x) => x + 1);
  }, [scrollActive]);

  const prevContentHRef = useRef(0);
  const prevHistoryStartRef = useRef(historyStart);
  useEffect(() => {
    if (scrollActive) return;

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

    if (store.chatScrollOffset <= 0) {
      if (store.maxChatScroll !== maxS) {
        store.setChatScrollLayout(maxS, 0);
      }
      return;
    }

    if (historyStart < prevHs && contentH > prevH && prevH > 0) {
      store.setMaxChatScroll(maxS, "pin-content");
      return;
    }

    if (prevH <= 0 || contentH === prevH) {
      if (store.maxChatScroll !== maxS) store.setMaxChatScroll(maxS, "pin-offset");
      else if (store.chatScrollOffset > maxS) store.setChatScrollLayout(maxS, maxS);
      return;
    }

    const nextFb = Math.max(0, Math.min(maxS, store.chatScrollOffset));
    store.setChatScrollLayout(maxS, nextFb);
  }, [contentH, maxS, viewHStable, autoFollow, windowed.length, historyStart, contentLayoutEpoch, scrollActive, heightTick]);

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
  }, [viewHStable, term.rows, term.cols, windowed.length, contentH, scrollActive]);

  // 「上一条用户」：用缓存 starts，不扫 Yoga 子树
  const olderUser = useMemo(() => {
    if (scrollActive || fb <= 0 || windowed.length === 0) return null;
    const topY = topYOf(contentH - BOTTOM_PAD, viewHStable, fb);
    let last: (Item & { type: "msg" }) | null = null;
    for (let i = 0; i < windowed.length; i++) {
      const start = starts[i] ?? 0;
      const h = heights[i] ?? 0;
      if (start + h > topY + 0.5) break;
      const it = windowed[i]!;
      if (it.type === "msg" && it.data.role === "user") last = it;
    }
    return last;
  }, [fb, windowed, contentH, viewHStable, scrollActive, starts, heights]);

  olderJumpRef.current = () => {
    if (!olderUser) return;
    const idx = windowed.findIndex((it) => it.id === olderUser.id);
    if (idx < 0) return;
    const top = starts[idx] ?? 0;
    const newFb = Math.max(0, Math.min(maxS, contentH - viewHStable - top));
    useStore.getState().setAutoFollow(false);
    useStore.getState().setChatScrollLayout(maxS, newFb);
  };

  const innerW = Math.max(16, term.cols - 2);
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

  const reserveRail = maxS > 0 || (!autoFollow && fromBottomStore > 0);
  const chatWFixed = reserveRail ? Math.max(8, innerW - 1) : innerW;

  const renderItem = (it: Item) => {
    if (!virtOn) {
      return it.type === "msg" ? (
        <MessageRow msg={it.data} frame={frame} />
      ) : (
        <SystemEventRow ev={it.data} />
      );
    }
    return (
      <MeasuredBlock
        id={it.id}
        measureKey={measureKeyFor(it, contentLayoutEpoch)}
        onHeight={onItemHeight}
        width={chatWFixed}
      >
        {it.type === "msg" ? (
          <MessageRow msg={it.data} frame={frame} />
        ) : (
          <SystemEventRow ev={it.data} />
        )}
      </MeasuredBlock>
    );
  };

  return (
    <Box ref={rootRef} flexDirection="column" flexGrow={1} width={innerW} overflow="hidden">
      <Box
        ref={olderUser && fb > 0 && !topHint ? olderBtnRef : undefined}
        flexShrink={0}
        width={innerW}
        height={1}
        overflow="hidden"
      >
        {topHint ? (
          <Text color={t.dim}>{fitPrefixLine("", topHint, innerW)}</Text>
        ) : olderUser && fb > 0 ? (
          <Text backgroundColor={t.userBg} color={t.user} bold>
            {olderLine || "↑ (上一条)"}
          </Text>
        ) : (
          <Text>{" "}</Text>
        )}
      </Box>

      <Box flexGrow={1} flexDirection="row" width={innerW} overflow="hidden">
        <Box
          ref={viewportRef}
          flexGrow={1}
          width={chatWFixed}
          overflow="hidden"
          flexDirection="column"
        >
          <Box
            ref={contentRef}
            flexShrink={0}
            marginTop={mt}
            flexDirection="column"
            width={chatWFixed}
          >
            {virtOn && vr.padTop > 0 ? (
              <Box height={vr.padTop} flexShrink={0} width={chatWFixed}>
                <Text>{" "}</Text>
              </Box>
            ) : null}

            {(virtOn ? visible : windowed).map((it) => (
              <React.Fragment key={`${it.type}:${it.id}`}>
                {renderItem(it)}
              </React.Fragment>
            ))}

            {virtOn && vr.padBottom > 0 ? (
              <Box height={vr.padBottom} flexShrink={0} width={chatWFixed}>
                <Text>{" "}</Text>
              </Box>
            ) : null}

            <Box height={BOTTOM_PAD} flexShrink={0} width={chatWFixed}>
              <Text>{" "}</Text>
            </Box>
          </Box>
        </Box>

        {reserveRail ? (
          <ScrollRail
            height={viewHStable}
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
