/**
 * Group flat draft messages into display hierarchy:
 * tool / thinking / err nest under the preceding assistant reply.
 */
import type { DraftMessage, MessageRole } from "./types";

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
  return t.length === 0 || t === "…" || t === "..." || t === "……";
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
