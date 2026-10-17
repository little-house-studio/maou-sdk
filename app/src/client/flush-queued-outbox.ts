/** 流结束后仍挂在 outbox 的排队条：是否从服务端取回并自己开一轮。 */

export type LeftoverOutboxItem = {
  status: string;
  text: string;
  queueId?: number;
};

export type LeftoverReplayKind = "idle" | "already-taken" | "replayed";

export type LeftoverReplayResult = {
  kind: LeftoverReplayKind;
  queueId?: number;
  text?: string;
};

export function firstLeftoverQueued(
  outbox: LeftoverOutboxItem[],
): { text: string; queueId: number } | null {
  const first = outbox.find(
    (o) => o.status === "queued" && o.text.trim() && o.queueId != null,
  );
  if (!first || first.queueId == null) return null;
  return { text: first.text, queueId: first.queueId };
}

/**
 * hub 已 takeNext 时 remove 失败 → 不再发。
 * 仅当还在队列里时由前端开一轮（旧包或入队发生在 drain 之后）。
 */
export async function replayLeftoverQueuedTurn(opts: {
  items: LeftoverOutboxItem[];
  isCurrentSession: () => boolean;
  isBusy: () => boolean;
  removeQueueItem: (id: number) => Promise<boolean>;
  startTurn: (text: string) => Promise<void>;
}): Promise<LeftoverReplayResult> {
  if (!opts.isCurrentSession() || opts.isBusy()) return { kind: "idle" };
  const first = firstLeftoverQueued(opts.items);
  if (!first) return { kind: "idle" };
  let removed = false;
  try {
    removed = await opts.removeQueueItem(first.queueId);
  } catch {
    return { kind: "already-taken", queueId: first.queueId };
  }
  if (!removed) return { kind: "already-taken", queueId: first.queueId };
  if (!opts.isCurrentSession() || opts.isBusy()) {
    return { kind: "idle", queueId: first.queueId };
  }
  await opts.startTurn(first.text);
  return { kind: "replayed", queueId: first.queueId, text: first.text };
}
