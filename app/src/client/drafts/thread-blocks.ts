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

export type ThreadBlock =
  | { kind: "solo"; message: DraftMessage }
  | {
      kind: "reply";
      /** Primary assistant message (may be missing if only tools) */
      assistant: DraftMessage | null;
      internals: DraftMessage[];
    };

export function isInternalRole(role: MessageRole): boolean {
  return INTERNAL_ROLES.has(role);
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
