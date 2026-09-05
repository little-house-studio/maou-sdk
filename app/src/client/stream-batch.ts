/**
 * Stream → UI frame batching.
 *
 * NDJSON deltas can arrive many times per frame. Applying each one straight
 * into React state re-renders the whole ChatPanel (and re-parses the streaming
 * markdown) per chunk. The batcher queues events and applies them together
 * once per animation frame, in arrival order, so the visible result is the
 * same but the render count is bounded by the display refresh rate.
 *
 * Adjacent text deltas of the same kind are merged into one event: applying
 * "ab" once equals applying "a" then "b" for both assistant and thinking
 * lines (see applyAssistantDelta / applyThinkingDelta), so the merge is lossless.
 */
import type { StreamEvent } from "./api";

export type StreamDeltaKind = "assistant" | "thinking";

/** Text-delta events that can be merged; anything else is applied as-is. */
export function streamDeltaKind(ev: StreamEvent): StreamDeltaKind | null {
  switch (ev.type) {
    case "assistant_delta":
    case "text_delta":
      return "assistant";
    case "thinking_delta":
    case "reasoning_delta":
      return "thinking";
    default:
      return null;
  }
}

export function streamDeltaText(ev: StreamEvent): string {
  return String(ev.delta ?? ev.content ?? "");
}

/** Merge runs of same-kind deltas; keep every other event and the overall order. */
export function coalesceStreamEvents(
  events: readonly StreamEvent[],
): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (const ev of events) {
    const kind = streamDeltaKind(ev);
    if (kind) {
      const prev = out[out.length - 1];
      if (prev && streamDeltaKind(prev) === kind) {
        out[out.length - 1] = {
          ...prev,
          delta: streamDeltaText(prev) + streamDeltaText(ev),
        };
        continue;
      }
    }
    out.push(ev);
  }
  return out;
}

export type FrameBatcher<T> = {
  /** Queue an item; schedules a flush on the next frame if none is pending. */
  push(item: T): void;
  /** Apply everything queued so far, synchronously. Safe to call when empty. */
  flush(): void;
  /** Drop everything queued without applying. */
  cancel(): void;
  /** Number of queued items. */
  size(): number;
};

export type FrameScheduler = {
  schedule: (cb: () => void) => unknown;
  cancel: (handle: unknown) => void;
};

/** requestAnimationFrame when available (renderer), else a short timer (tests / node). */
export function defaultFrameScheduler(): FrameScheduler {
  if (
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function"
  ) {
    return {
      schedule: (cb) => requestAnimationFrame(() => cb()),
      cancel: (h) => cancelAnimationFrame(h as number),
    };
  }
  return {
    schedule: (cb) => setTimeout(cb, 16),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

export function createFrameBatcher<T>(
  apply: (items: T[]) => void,
  scheduler: FrameScheduler = defaultFrameScheduler(),
): FrameBatcher<T> {
  let queue: T[] = [];
  let handle: unknown = null;

  const flush = () => {
    if (handle != null) {
      scheduler.cancel(handle);
      handle = null;
    }
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    apply(items);
  };

  return {
    push(item) {
      queue.push(item);
      if (handle == null) {
        handle = scheduler.schedule(() => {
          handle = null;
          flush();
        });
      }
    },
    flush,
    cancel() {
      if (handle != null) {
        scheduler.cancel(handle);
        handle = null;
      }
      queue = [];
    },
    size: () => queue.length,
  };
}
