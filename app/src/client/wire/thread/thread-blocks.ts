/**
 * Group flat draft messages into display hierarchy:
 * tool / thinking / err nest under the preceding assistant reply.
 */
import type { DraftMessage, MessageRole } from "../types";
import { durationStr } from "./message-meta";

const INTERNAL_ROLES: ReadonlySet<MessageRole> = new Set([
  "thinking",
  "tool",
  "err",
]);

export type ReplyBlock = {
  kind: "reply";
  /** Primary assistant message (may be missing if only tools) */
  assistant: DraftMessage | null;
  internals: DraftMessage[];
};

export type ThreadBlock =
  | { kind: "solo"; message: DraftMessage }
  | ReplyBlock;

/** user 消息 + 其后连续 assistant 轮，直到下一条 user / system。 */
export type LoopSegment = {
  kind: "loop";
  user: DraftMessage | null;
  replies: ReplyBlock[];
};

export type ThreadSegment =
  | { kind: "solo"; message: DraftMessage }
  | LoopSegment;

export function isInternalRole(role: MessageRole): boolean {
  return INTERNAL_ROLES.has(role);
}

/** Empty / ellipsis-only assistant body — not a visible reply line. */
export function isPlaceholderAssistantBody(body: string | undefined): boolean {
  const t = (body ?? "").trim();
  if (t.length === 0 || t === "…" || t === "..." || t === "……") return true;
  if (isModelCallProgressText(t)) return true;
  const unprefixed = t.replace(/^(?:…|\.{2,3}|……)\s*/, "");
  return unprefixed !== t && isModelCallProgressText(unprefixed);
}

/** Runtime 循环进度（status / log），不是给人看的系统通知。 */
export function isModelCallProgressText(text: string): boolean {
  const t = text.trim().replace(/^(?:⏳\s*)+/, "");
  if (
    /模型不支持多模态/.test(t) ||
    /Unsupported media/i.test(t) ||
    /非文本块后重试/.test(t)
  ) {
    return true;
  }
  return /^(?:调用模型|编译\s*Prompt|开始编译\s*Prompt|规划目标合同)(?:\.\.\.|…|：|:|\s|$)/.test(
    t,
  );
}

/**
 * 同工具连打的软提醒：只喂模型，人看不见。
 * 助手正文偶尔提到「请换策略」不要误伤。
 */
export function isToolLoopHintText(text: string): boolean {
  const t = text.trim().replace(/^(?:⏳\s*)+/, "");
  if (!t) return false;
  if (/工具循环警告/.test(t)) return true;
  if (/检测到工具调用(?:可能陷入)?死循环/.test(t)) return true;
  if (/dominant\s*≈/.test(t)) return true;
  if (/同一工具连续\s*\d+/.test(t) || /同一调用第\s*\d+/.test(t)) return true;
  if (/请换策略/.test(t) && /<continue>|死循环|重复模式|换工具/.test(t)) {
    return true;
  }
  return false;
}

/** 落盘 runtime_control / 直播 system 行：按 source 或正文藏起来。 */
export function isHiddenToolLoopLine(input: {
  role?: string;
  source?: string;
  text?: string;
  content?: string;
}): boolean {
  const source = (input.source || "").trim();
  if (source === "tool_loop" || source === "tool_streak") return true;
  const role = input.role || "";
  if (role === "assistant" || role === "tool" || role === "thinking") return false;
  return isToolLoopHintText(input.text || input.content || "");
}

/** 真人入口（与 session-event SOURCE_KIND 对齐）。 */
const HUMAN_USER_SOURCES = new Set(["human", "user", "cli", "feishu"]);

const NON_BUBBLE_KINDS = new Set([
  "tool_async_notify",
  "tool_result",
  "runtime_control",
  "system_notice",
  "agent_message",
  "compact",
  "tool_call",
  "assistant_turn",
]);

export type UserLineMeta = {
  role?: string;
  source?: string;
  kind?: string;
  authorType?: string;
  text?: string;
  content?: string;
};

/** 旧盘没写 author/kind/source 时，当时终端完成 / 工具 follow-up 带着协议标签。 */
function hasLegacyInjectedUserMarkup(body: string): boolean {
  return body.includes("<terminal-message>") || body.includes("<tool-followup");
}

/**
 * 用户卡只给真人。wireRole 可能是 user（喂模型），看 author / kind / source。
 * 正文标签不是主路径，只兼容旧盘。
 */
export function isHumanUserBubble(input: UserLineMeta): boolean {
  if ((input.role || "") !== "user") return false;
  const authorType = (input.authorType || "").trim();
  if (authorType === "human") return true;
  if (
    authorType === "tool" ||
    authorType === "system" ||
    authorType === "agent"
  ) {
    return false;
  }
  const kind = (input.kind || "").trim();
  if (kind === "human_user" || kind === "queued_user") return true;
  if (NON_BUBBLE_KINDS.has(kind)) return false;
  const source = (input.source || "").trim();
  if (source) return HUMAN_USER_SOURCES.has(source);
  return !hasLegacyInjectedUserMarkup(input.text || input.content || "");
}

export type UserDisplayRole = "user" | "tool" | "system";

/** 非真人的 wire-user：终端完成 / 工具 follow-up 走工具卡，其余走系统条。 */
export function displayRoleForUserLine(input: UserLineMeta): UserDisplayRole {
  if ((input.role || "") !== "user") return "system";
  if (isHumanUserBubble(input)) return "user";
  const source = (input.source || "").trim();
  const kind = (input.kind || "").trim();
  const authorType = (input.authorType || "").trim();
  if (
    authorType === "tool" ||
    source === "terminal-notification" ||
    source === "tool-followup" ||
    source === "tool" ||
    kind === "tool_async_notify" ||
    kind === "tool_result" ||
    (!source && !kind && !authorType && hasLegacyInjectedUserMarkup(input.text || input.content || ""))
  ) {
    return "tool";
  }
  return "system";
}

/** 分类靠元数据；解开标签只为展示。 */
export function unwrapInjectedNoticeBody(text: string): string {
  const t = (text || "").trim();
  const term = t.match(
    /^<terminal-message>\s*([\s\S]*?)\s*<\/terminal-message>\s*$/i,
  );
  if (term) return term[1]!.trim();
  const follow = t.match(
    /^<tool-followup\b[^>]*>\s*([\s\S]*?)\s*<\/tool-followup>\s*$/i,
  );
  if (follow) return follow[1]!.trim();
  return text;
}

export function replyBlockLive(block: ReplyBlock): boolean {
  return (
    Boolean(block.assistant?.meta?.streaming) ||
    block.internals.some(
      (part) =>
        Boolean(part.thinking?.streaming) ||
        (part.role === "tool" && part.tool != null && part.tool.done === false),
    )
  );
}

/** Skip blank assistant rows (no text, no internals) unless the turn is still live. */
export function replyTurnVisible(block: ReplyBlock, loopLive = false): boolean {
  if (block.internals.length > 0) return true;
  if (block.assistant && !isPlaceholderAssistantBody(block.assistant.body)) {
    return true;
  }
  return loopLive || replyBlockLive(block);
}

/** Live wait chrome: same strip as thinking, while the model or a tool has not returned. */
export function replyWaitStatus(
  block: ReplyBlock,
  loopLive = false,
): { label: string; startedAt?: number } | null {
  const thinkingLive = block.internals.some((part) =>
    Boolean(part.thinking?.streaming),
  );
  if (thinkingLive) return null;
  const showBody =
    Boolean(block.assistant) &&
    !isPlaceholderAssistantBody(block.assistant?.body);
  if (showBody) return null;
  const runningTool = block.internals.find(
    (part) => part.role === "tool" && part.tool != null && part.tool.done === false,
  );
  if (!loopLive && !replyBlockLive(block) && !runningTool) return null;
  return {
    label: runningTool ? "等待工具返回…" : "等待响应…",
    startedAt:
      runningTool?.meta?.ts ??
      block.assistant?.meta?.ts,
  };
}

/** 折叠行字数上限。clipTurnSummary / summarizeReplyTurn 读写。 */
export const TURN_SUMMARY_MAX = 48;

/** 折叠行短句：空白压成一格，尽量取首句，超长截断。 */
export function clipTurnSummary(text: string, max = TURN_SUMMARY_MAX): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const budget = Math.max(8, max);
  let cut = -1;
  for (let i = 0; i < t.length; i++) {
    if (!"。！？.!?".includes(t[i]!)) continue;
    cut = i + 1;
    if (cut >= 4) break;
  }
  const bit = cut > 0 ? t.slice(0, cut) : t;
  if (bit.length <= budget) return bit;
  return `${bit.slice(0, budget - 1).trimEnd()}…`;
}

function firstToolName(internals: DraftMessage[]): string {
  const tool = internals.find((m) => m.role === "tool");
  if (!tool) return "";
  const name = (tool.tool?.name || tool.tag || "").trim();
  if (name && name !== "tool") return name;
  return "工具";
}

function thinkSummary(internals: DraftMessage[]): string {
  const th = internals.find((m) => m.role === "thinking");
  if (!th) return "";
  const ms = th.thinking?.durationMs ?? th.meta?.durationMs;
  const dur = durationStr(ms);
  return dur ? `Thought · ${dur}` : "Thought";
}

/** 一轮折叠行摘要：助手首句，否则首个工具名，否则 Thought 时长。WireThreadView 读。 */
export function summarizeReplyTurn(block: ReplyBlock): string {
  const body = block.assistant?.body;
  if (body && !isPlaceholderAssistantBody(body)) {
    const line = clipTurnSummary(body);
    if (line) return line;
  }
  const tool = firstToolName(block.internals);
  if (tool) return tool;
  const think = thinkSummary(block.internals);
  if (think) return think;
  if (block.internals.some((m) => m.role === "err")) return "错误";
  return "此轮";
}

function finiteDur(ms?: number | null): number | undefined {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined;
  return ms;
}

export function replyTurnToolCount(block: ReplyBlock): number {
  return block.internals.filter((m) => m.role === "tool").length;
}

/** 本轮用时：助手 duration，否则累加工具 / 思考。 */
export function replyTurnDurationMs(block: ReplyBlock): number | undefined {
  const a = finiteDur(block.assistant?.meta?.durationMs);
  if (a != null) return a;
  let sum = 0;
  let any = false;
  for (const part of block.internals) {
    const ms = finiteDur(
      part.tool?.durationMs ?? part.thinking?.durationMs ?? part.meta?.durationMs,
    );
    if (ms == null) continue;
    sum += ms;
    any = true;
  }
  return any ? sum : undefined;
}

/** 单轮收纳行：时长 · 工具数。AssistantTurn 折叠钮读。 */
export function formatReplyTurnFold(block: ReplyBlock): string {
  const dur = durationStr(replyTurnDurationMs(block));
  const tools = `${replyTurnToolCount(block)} 工具`;
  return dur ? `${dur} · ${tools}` : tools;
}

export function packReplyStats(blocks: ReplyBlock[]): {
  roundCount: number;
  toolCount: number;
  durationMs?: number;
} {
  let toolCount = 0;
  let durationMs = 0;
  let anyDur = false;
  for (const b of blocks) {
    toolCount += replyTurnToolCount(b);
    const d = replyTurnDurationMs(b);
    if (d == null) continue;
    durationMs += d;
    anyDur = true;
  }
  return {
    roundCount: blocks.length,
    toolCount,
    durationMs: anyDur ? durationMs : undefined,
  };
}

/** 总包收纳行：轮数 · 时长 · 工具数。ReplyPackFold 悬停/读屏读。 */
export function formatReplyPackFold(blocks: ReplyBlock[]): string {
  const s = packReplyStats(blocks);
  const rounds = `${s.roundCount} 轮`;
  const tools = `${s.toolCount} 工具`;
  const dur = durationStr(s.durationMs);
  return dur ? `${rounds} · ${dur} · ${tools}` : `${rounds} · ${tools}`;
}

/** 总包行：工具数 · 时长。ReplyPackFold 读。 */
export function formatReplyPackMeta(blocks: ReplyBlock[]): string {
  const s = packReplyStats(blocks);
  const tools = `${s.toolCount} 工具`;
  const dur = durationStr(s.durationMs);
  return dur ? `${tools} · ${dur}` : tools;
}

/** 两轮及以上已结束的更早轮才出总包。 */
export function replyPackable(foldableCount: number): boolean {
  return foldableCount >= 2;
}

/** 默认识总包；用户点过才展开成多行。不够包时直接出各轮。 */
export function replyPackOpen(input: {
  packable: boolean;
  userOpen?: boolean;
}): boolean {
  if (!input.packable) return true;
  if (input.userOpen != null) return input.userOpen;
  return false;
}

/**
 * 默认展开：最后一轮，或本轮 / 本 loop 仍在跑。
 * userOpen 是用户点过或「刚卸任的最后一轮」钉住的覆盖；正在跑的最后一轮忽略收起。
 */
export function replyTurnOpen(input: {
  isLastVisible: boolean;
  turnLive: boolean;
  loopLive: boolean;
  userOpen?: boolean;
}): boolean {
  const mustOpen = input.turnLive || (input.isLastVisible && input.loopLive);
  if (mustOpen) return true;
  if (input.userOpen != null) return input.userOpen;
  return input.isLastVisible;
}

/**
 * 新轮出现后，上一轮不再是最后一轮。
 * 没记过用户意向时钉开：生成中最后一轮本来就没有折叠钮，不钉会被默认收起。
 * foldOpen 在 LoopBlock / WireThreadView 读写。
 */
export function pinReleasedLastTurn(
  foldOpen: Record<string, boolean>,
  prevLastKey: string | null,
  nextLastKey: string | null,
): Record<string, boolean> {
  if (!prevLastKey || prevLastKey === nextLastKey) return foldOpen;
  if (prevLastKey in foldOpen) return foldOpen;
  return { ...foldOpen, [prevLastKey]: true };
}

/** 更早且已结束的轮次才出折叠行。最后一轮 / 仍在跑的轮次不折。 */
export function replyTurnFoldable(input: {
  isLastVisible: boolean;
  turnLive: boolean;
}): boolean {
  return !input.isLastVisible && !input.turnLive;
}

/** Pure grouping used by ContextPanel — keep tests free of React. */
export function groupThreadBlocks(messages: DraftMessage[]): ThreadBlock[] {
  const blocks: ThreadBlock[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i]!;
    if (m.role === "user" || m.role === "system") {
      blocks.push({ kind: "solo", message: m });
      i += 1;
      continue;
    }

    if (m.role === "assistant") {
      const internals: DraftMessage[] = [];
      let j = i + 1;
      while (j < messages.length && isInternalRole(messages[j]!.role)) {
        internals.push(messages[j]!);
        j += 1;
      }
      blocks.push({ kind: "reply", assistant: m, internals });
      i = j;
      continue;
    }

    // Orphan internals (no leading assistant): still one nested reply group
    if (isInternalRole(m.role)) {
      const internals: DraftMessage[] = [m];
      let j = i + 1;
      while (j < messages.length && isInternalRole(messages[j]!.role)) {
        internals.push(messages[j]!);
        j += 1;
      }
      blocks.push({ kind: "reply", assistant: null, internals });
      i = j;
      continue;
    }

    blocks.push({ kind: "solo", message: m });
    i += 1;
  }
  return blocks;
}

/** Fold reply blocks after a user into one loop; system / stray solos stay outside. */
export function groupLoopTurns(blocks: ThreadBlock[]): ThreadSegment[] {
  const out: ThreadSegment[] = [];
  let user: DraftMessage | null = null;
  let replies: ReplyBlock[] = [];

  const flush = () => {
    if (!user && replies.length === 0) return;
    if (user && replies.length === 0) {
      out.push({ kind: "solo", message: user });
    } else {
      out.push({ kind: "loop", user, replies });
    }
    user = null;
    replies = [];
  };

  for (const block of blocks) {
    if (block.kind === "solo") {
      if (
        block.message.role === "user" &&
        isHumanUserBubble({
          role: block.message.role,
          source: block.message.source,
          kind: block.message.meta?.kind,
          authorType: block.message.authorType,
          content: block.message.body,
        })
      ) {
        flush();
        user = block.message;
        continue;
      }
      flush();
      out.push(block);
      continue;
    }
    replies.push(block);
  }
  flush();
  return out;
}

function sameReplyBlock(a: ReplyBlock, b: ReplyBlock): boolean {
  if (a === b) return true;
  if (a.assistant !== b.assistant) return false;
  if (a.internals.length !== b.internals.length) return false;
  for (let i = 0; i < a.internals.length; i++) {
    if (a.internals[i] !== b.internals[i]) return false;
  }
  return true;
}

function sameThreadSegment(a: ThreadSegment, b: ThreadSegment): boolean {
  if (a === b) return true;
  if (a.kind === "solo" || b.kind === "solo") {
    return a.kind === "solo" && b.kind === "solo" && a.message === b.message;
  }
  if (a.user !== b.user || a.replies.length !== b.replies.length) return false;
  for (let i = 0; i < a.replies.length; i++) {
    if (!sameReplyBlock(a.replies[i]!, b.replies[i]!)) return false;
  }
  return true;
}

/**
 * Structural sharing for segments: a loop whose user + reply messages are the
 * same objects as last time keeps its previous segment (and `replies` array),
 * so a memo'd LoopBlock skips. Pairs with reuseDraftMessages upstream —
 * message identity is preserved there, segment identity here.
 */
export function reuseThreadSegments(
  prev: readonly ThreadSegment[],
  next: readonly ThreadSegment[],
): ThreadSegment[] {
  if (prev.length === 0) return next.slice();
  let kept = 0;
  const out = next.map((seg, i) => {
    const p = prev[i];
    if (p && sameThreadSegment(p, seg)) {
      kept += 1;
      return p;
    }
    return seg;
  });
  return kept === next.length && prev.length === next.length
    ? (prev as ThreadSegment[])
    : out;
}

export function replyAnchorId(block: ReplyBlock): string {
  return block.assistant?.id || block.internals[0]?.id || "";
}

export function replyHasSubmitPlan(block: ReplyBlock): boolean {
  return block.internals.some((m) => {
    if (m.role !== "tool") return false;
    const name = (m.tool?.name || "").trim().toLowerCase();
    if (name === "submit_plan") return true;
    return /(?:^|[\s▶✓✗×❌])submit_plan(?:\b|$)/i.test(m.body || "");
  });
}

/** 写出计划的那一轮。待审且尚未落点时才允许退到当前最后一轮。 */
export function pickPlanReviewAnchorId(
  segments: readonly ThreadSegment[],
  opts?: { fallback?: boolean },
): string | null {
  let fallback: string | null = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    if (seg.kind !== "loop") continue;
    for (let j = seg.replies.length - 1; j >= 0; j--) {
      const block = seg.replies[j]!;
      if (replyHasSubmitPlan(block)) {
        return replyAnchorId(block) || null;
      }
      if (!fallback) {
        const id = replyAnchorId(block);
        if (id) fallback = id;
      }
    }
  }
  return opts?.fallback ? fallback : null;
}
