// ── 对话区稳定区 + 活跃区构建 ─────────────────────────────────────────
//
// 稳定区：已 finalize 消息（user 已发、assistant 已 done），字节冻结，
//   报告为 liveRegionStart——滚出视口顶部的行被 Pi 引擎提交进终端原生
//   scrollback，用户用终端滚轮翻历史。
// 活跃区：当前 streaming 的 assistant 消息，视口内就地重绘。
//   commitSafeEnd 报告其已生成的稳定前缀（最后一行除外），让长消息
//   滚出视口的头部也能提前进 scrollback，不悬空。
//
// 从 App.buildChatRegions 拆出。RegionCache 持有稳定/活跃行缓存与签名，
// 由 App 实例化并传入（函数本身无状态）。

import type { UIState } from "../state/types.js";
import type { MdCache } from "../render/markdown.js";
import { renderMessage } from "../render/message.js";

export interface RegionCache {
  /** 已 finalize 消息渲染成的稳定行（字节冻结，可进 scrollback） */
  stableRows: readonly string[];
  /** 生成 stableRows 时的 messages 快照签名（messages 长度 + 最后一条 id + width） */
  stableSig: string;
  /** 当前流式消息渲染成的活跃行（视口内重绘） */
  liveRows: readonly string[];
  liveSig: string;
  /** liveRegionStart = stableRows.length（稳定区结束 = 活跃区开始） */
  liveRegionStart: number;
  /** commitSafeEnd = stableRows.length + 流式消息已稳定前缀行数 */
  commitSafeEnd: number;
}

/**
 * 构建对话区两段：稳定区（已 finalize 消息）+ 活跃区（当前流式消息）。
 * 稳定区用签名缓存避免每帧重渲染已完成消息；活跃区每帧重建（内容在变）。
 *
 * @param state        UIState
 * @param spinnerFrame 当前 spinner 帧号（活跃区 thinking/tool 动画用）
 * @param mdCache      Markdown 实例缓存（renderMessage 用）
 * @param width        渲染宽度
 * @param cache        RegionCache（函数会就地更新其字段）
 */
export function buildChatRegions(
  state: UIState,
  spinnerFrame: number,
  mdCache: MdCache,
  width: number,
  cache: RegionCache,
): void {
  const msgs = state.messages;
  const streamingId = state.streaming ? state.currentAssistantId : null;

  // ── 稳定区：所有非 streaming 消息 ──
  const stableMsgs = msgs.filter(m => m.id !== streamingId && !m.streaming);
  const stableSig = `${stableMsgs.length}:${stableMsgs[stableMsgs.length - 1]?.id ?? ""}:${width}`;
  if (stableSig !== cache.stableSig) {
    const rows: string[] = [];
    for (const m of stableMsgs) rows.push(...renderMessage(m, state, spinnerFrame, mdCache, width));
    cache.stableRows = rows;
    cache.stableSig = stableSig;
  }

  // ── 活跃区：当前流式消息（streaming 中或刚 done 但本轮的） ──
  const liveMsg = streamingId ? msgs.find(m => m.id === streamingId) : null;
  const liveSig = `${liveMsg?.id ?? ""}:${liveMsg?.blocks.map(b => b.type === "text" || b.type === "thinking" ? b.content.length : b.type === "tool" ? (b.result?.length ?? 0) : 0).join(",") ?? ""}:${width}`;
  let liveRows: readonly string[] = [];
  if (liveMsg) {
    const rows: string[] = [];
    rows.push(...renderMessage(liveMsg, state, spinnerFrame, mdCache, width));
    liveRows = rows;
    // commitSafeEnd：流式消息除最后一行外都算稳定（追加式，已生成 token 不变）
    // 最后一行可能在变（流式光标、正在打字），排除它。
    const stablePrefix = Math.max(0, rows.length - 1);
    cache.commitSafeEnd = cache.stableRows.length + stablePrefix;
  } else {
    cache.commitSafeEnd = cache.stableRows.length;
  }
  // 仅在签名变化时更新 liveRows 引用（减少引擎 diff）
  if (liveSig !== cache.liveSig) {
    cache.liveRows = liveRows;
    cache.liveSig = liveSig;
  }

  // liveRegionStart = 稳定区长度（稳定区结束 = 活跃区开始）
  cache.liveRegionStart = cache.stableRows.length;
}
