// ── 消息渲染（角色头+loop分割+blocks遍历） ────────────────────────────
//
// user 消息前加实心块分割（标示新一轮 loop 开始）+ 块 id。
// 按 blocks 顺序渲染（text/thinking/tool 天然穿插，按时序）。

import type { ChatMessage, UIState } from "../state/types.js";
import { C, fg } from "../theme/colors.js";
import { SYM } from "../theme/symbols.js";
import { timecode, codename } from "./decorators.js";
import { renderMarkdown, type MdCache } from "./markdown.js";
import { renderThinking } from "./thinking.js";
import { renderToolCard } from "./toolcard.js";

export function renderMessage(
  msg: ChatMessage,
  state: UIState,
  spinnerFrame: number,
  mdCache: MdCache,
  width: number,
): string[] {
  const rows: string[] = [];
  // user 消息前加实心块分割（标示新一轮 loop 开始）+ 块 id
  if (msg.role === "user") {
    const round = state.round;
    const blockId = msg.id.slice(-6);
    const sep = fg(C.borderAccent)("▆".repeat(Math.min(width, 60)));
    const label = fg(C.dim)(` loop #${round} · ${blockId} `);
    rows.push(sep);
    rows.push(label);
  }
  // 角色头（含块 id，便于回溯定位）
  const roleColor = msg.role === "user" ? fg(C.user) : msg.role === "system" ? fg(C.system) : fg(C.assistant);
  const roleLabel = msg.role === "user" ? "user" : msg.role === "system" ? "sys" : "ai";
  const ts = new Date(msg.ts);
  const blockId = msg.id.slice(-6);
  rows.push(`${roleColor(`${SYM.index} ${roleLabel}`)} ${fg(C.dim)(timecode(ts))} ${fg(C.dim)(`#${blockId}`)} ${fg(C.muted)(codename(msg.role))}`);

  // 按 blocks 顺序渲染（text/thinking/tool 天然穿插，按时序）
  for (const block of msg.blocks) {
    if (block.type === "text" && block.content) {
      rows.push(...renderMarkdown(msg.id, block.content, width, !!msg.streaming, mdCache));
    } else if (block.type === "thinking") {
      rows.push(...renderThinking(block, width));
    } else if (block.type === "tool") {
      // symbolTheme.spinnerFrames 在此间接通过 renderToolCard 使用
      rows.push(...renderToolCard(block, state, spinnerFrame, width));
    }
  }

  rows.push(""); // 消息间空行
  return rows;
}
