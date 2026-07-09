/**
 * ScrollHistory —— 行级平滑滚动 + 自动跟随底部（网页感）。
 *
 * 实现原理（参考 ByteLandTechnology/ink-scroll-view 的 ControlledScrollView）：
 *   <Box ref={viewportRef} height={H} overflow="hidden">   ← 视口，固定高度，裁剪
 *     <Box ref={contentRef} flexShrink={0} marginTop={-scrollTop}>  ← 内容，不压缩，上移
 *       {所有消息}
 *     </Box>
 *   </Box>
 *
 * 关键点（经验证）：
 *   - 内容 Box 必须 flexShrink={0}，否则 flexGrow 父级会把内容压成视口高度，
 *     导致 contentHeight == viewportHeight，maxScrollTop=0，滚轮失效。
 *   - 视口用固定 height（不用 flexGrow），Yoga 才能正确算视口高度。
 *   - Ink <Box> 支持负数 marginTop（经 Yoga），配合 overflow="hidden" 实现行级滚动。
 *   - useBoxMetrics 用 yogaNode.getComputedLayout() 拿元素自身布局高度，
 *     不受 overflow 裁剪影响。
 *
 * offset 语义：0=看最新（底部），增大=向上看更早。
 * marginTop = -(maxScroll - offset)：offset=0 时 mt=-maxScroll（内容上移到底部），
 * offset=maxScroll 时 mt=0（内容顶部对齐视口顶部）。
 *
 * autoFollow：新消息到达时若用户在底部则自动跟随；用户上滚后停止跟随，回到底部重启。
 */

import React, { useRef, useEffect } from "react";
import { Box, Text, useBoxMetrics } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useClickTarget } from "../input/click-target.js";
import { MessageRow } from "./messages/MessageRow.js";
import { SystemEventRow } from "./messages/SystemEventRow.js";

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
  const bottomBtnRef = useRef<DOMElement | null>(null);
  useClickTarget(bottomBtnRef, () => useStore.getState().scrollToBottom(), []);

  // 可用高度：终端高 - 顶栏(1) - 对话区上下边框(2) - 事件块(1) - 输入框(1) - 状态栏(1) = rows - 6
  const availableRows = Math.max(4, term.rows - 6);

  // 测量内容总高度，算 maxScrollTop 回写 store。
  // 守卫：max 无变化时不 set，避免流式每 delta 触发无意义重渲（闪烁根因之一）。
  // !autoFollow 时（用户上滚钉住视口）：max 增大 Δ，offset 同步加 Δ，使 marginTop 不变，
  // 新内容在底部增长、视口内容不动——修复"不在底部却跟着生成移动"。
  // autoFollow 时 offset=0 钉底，新内容到达跟随到底部（期望行为）。
  const contentHeight = contentMetrics.height;
  useEffect(() => {
    const max = Math.max(0, contentHeight - availableRows);
    setMaxChatScroll(max, /*followGrowth=*/ true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentHeight, availableRows]);

  if (messages.length === 0) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
        <Text color={t.accent} bold>▌ MAOU // 待命</Text>
        <Text color={t.dim}>输入消息开始对话</Text>
        <Text color={t.dim}>Ctrl+K 命令 · Ctrl+E 全屏 · Ctrl+G 编辑器 · Ctrl+C 退出</Text>
      </Box>
    );
  }

  // offset=0 看底部：marginTop = -(max - offset)
  // offset=max 看顶部：marginTop = 0
  // autoFollow=true 时强制 offset=0（钉到底），不读 chatScrollOffset——避免回写循环
  const rawOffset = Math.min(chatScrollOffset, maxChatScroll);
  const offset = autoFollow ? 0 : rawOffset;
  const marginTop = -(maxChatScroll - offset);
  const hasNewer = offset > 0;       // 用户上滚看更早，底部有未看的更新内容
  const hasOlder = offset < maxChatScroll;  // 上方还有更早内容

  // 合并 messages + systemEvents 按 ts 排序，统一渲染
  const items: { type: "msg" | "sys"; ts: number; data: unknown }[] = [
    ...messages.map(m => ({ type: "msg" as const, ts: m.ts, data: m })),
    ...systemEvents.map(e => ({ type: "sys" as const, ts: e.ts, data: e })),
  ].sort((a, b) => a.ts - b.ts);

  // 找视口上方最近的 user 消息：items 里在当前可见区之前、role=user 的最后一条。
  // 可见区顶部对应的 content y = offset；遍历 items 累计高度，找到 y <= offset 的最后一条 user 消息。
  const olderUserPreview = (() => {
    if (!hasOlder) return null;
    // contentRef 的子节点是各 item；用 yogaNode 累计高度找 offset 对应的 item 索引
    const contentEl = contentRef.current as DOMElement | null;
    if (!contentEl?.yogaNode) {
      // 首帧未测量：退而取倒数第二条 user 消息（最近一条 user 多在底部）
      const users = items.filter(it => it.type === "msg" && (it.data as { role: string }).role === "user");
      return users.length >= 2 ? users[users.length - 2] : null;
    }
    let y = 0;
    let topItemIdx = 0;
    for (let i = 0; i < items.length; i++) {
      const child = contentEl.childNodes[i] as DOMElement | undefined;
      const h = child?.yogaNode?.getComputedLayout?.()?.height ?? 0;
      if (y + h > offset) { topItemIdx = i; break; }
      y += h;
      topItemIdx = i + 1;
    }
    // 视口上方 = items[0..topItemIdx)，找最后一条 user
    for (let i = topItemIdx - 1; i >= 0; i--) {
      if (items[i].type === "msg" && (items[i].data as { role: string }).role === "user") {
        return items[i];
      }
    }
    return null;
  })();

  // 点击预览 → 跳到那条消息：算它在 content 里的 y，设 offset=y（让它滚到视口顶）
  const jumpToOlderUser = () => {
    if (!olderUserPreview) return;
    const contentEl = contentRef.current as DOMElement | null;
    if (!contentEl?.yogaNode) { useStore.getState().scrollToBottom(); return; }
    const targetTs = olderUserPreview.ts;
    let y = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].ts === targetTs) break;
      const child = contentEl.childNodes[i] as DOMElement | undefined;
      y += child?.yogaNode?.getComputedLayout?.()?.height ?? 0;
    }
    useStore.getState().setAutoFollow(false);
    useStore.getState().setChatScrollOffset(y);
  };
  const olderBtnRef = useRef<DOMElement | null>(null);
  useClickTarget(olderBtnRef, jumpToOlderUser, [olderUserPreview?.ts, offset, maxChatScroll]);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {hasOlder && olderUserPreview && (
        <Box ref={olderBtnRef} flexShrink={0}>
          <Text color={t.dim}>↑ </Text>
          <Text color={t.accent}>{((olderUserPreview.data as { content: string }).content ?? "").slice(0, term.cols - 6).replace(/\n/g, " ")}</Text>
        </Box>
      )}
      <Box ref={viewportRef} height={availableRows} overflow="hidden" flexDirection="column">
        <Box ref={contentRef} flexShrink={0} marginTop={marginTop} flexDirection="column">
          {items.map(it => it.type === "msg"
            ? <MessageRow key={`m${(it.data as { id: string }).id}`} msg={it.data as never} frame={frame} />
            : <SystemEventRow key={`s${(it.data as { id: string }).id}`} ev={it.data as never} />)}
        </Box>
      </Box>
      {hasNewer && (
        <Box ref={bottomBtnRef} justifyContent="center" flexShrink={0}>
          <Text backgroundColor="#fff" color="#000" bold>  ↓ 点击回到最底部  </Text>
        </Box>
      )}
    </Box>
  );
}
