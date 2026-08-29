/**
 * Group flat draft messages into display hierarchy:
 * tool / thinking / err nest under the preceding assistant reply.
 */
import type { DraftMessage, MessageRole } from "./types";
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
  return /^(?:调用模型|编译\s*Prompt|开始编译\s*Prompt|规划目标合同)(?:\.\.\.|…|：|:|\s|$)/.test(
    t,
  );
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
export function replyTurnVisible(block: ReplyBlock): boolean {
  if (block.internals.length > 0) return true;
  if (block.assistant && !isPlaceholderAssistantBody(block.assistant.body)) {
    return true;
  }
  return replyBlockLive(block);
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
      if (block.message.role === "user") {
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
