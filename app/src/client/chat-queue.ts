import type { ChatSendMode, QueuedChatItem } from "./api";

export type OutboxItem = {
  localId: string;
  text: string;
  status: "sending" | "queued" | "failed";
  mode: ChatSendMode;
  queueId?: number;
  error?: string;
  locked?: boolean;
};

/** Identity is never inferred from text: identical messages are separate requests. */
export function reconcileQueue(local: readonly OutboxItem[], server: readonly QueuedChatItem[], consumed: ReadonlySet<number> = new Set()): OutboxItem[] {
  const remote = server.filter(item => !consumed.has(item.id)).map(item => {
    const previous = local.find(o => o.queueId === item.id || (item.requestId && o.localId === item.requestId));
    return {
      localId: previous?.localId ?? item.requestId ?? `queue-${item.id}`,
      queueId: item.id, text: item.message, status: "queued" as const,
      mode: item.mode === "interrupt_immediately" ? "insert" as const : "queue" as const,
    };
  });
  const ids = new Set(remote.map(item => item.localId));
  return [...remote, ...local.filter(item => item.status !== "queued" && !ids.has(item.localId) && !(item.queueId != null && consumed.has(item.queueId)))];
}
