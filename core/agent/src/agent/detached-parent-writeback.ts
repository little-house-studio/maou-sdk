/**
 * detached fork 结束后往父会话写一条可见结果。
 */

import {
  appendSessionEvent,
  authorAgent,
  type SessionStore,
} from "@little-house-studio/context";
import { formatProjectDispatchResult } from "@little-house-studio/tools";
import { formatSenderEnvelope } from "@little-house-studio/types";
import type { LifecycleEvent } from "./event-bus.js";

export function buildDetachedParentWriteback(
  ev: Extract<LifecycleEvent, { kind: "fork_end" }>,
): { parentSessionId: string; event: Parameters<typeof appendSessionEvent>[2] } | null {
  const parentSessionId = ev.parentSessionId?.trim();
  if (!ev.detached || !parentSessionId) return null;
  const name = ev.agentName?.trim() || "coding";
  return {
    parentSessionId,
    event: {
      kind: "agent_message",
      content: formatSenderEnvelope({
        body: formatProjectDispatchResult({
          ok: ev.ok,
          projectName: name,
          sessionId: ev.subSessionId,
          output: ev.output,
        }),
        from: name,
        type: "report",
      }),
      source: "project_dispatch",
      author: authorAgent(name, name),
      meta: {
        fromSessionId: ev.subSessionId,
        fromAgent: name,
      },
    },
  };
}

export function writeDetachedResultToParent(
  store: SessionStore,
  ev: Extract<LifecycleEvent, { kind: "fork_end" }>,
): boolean {
  const built = buildDetachedParentWriteback(ev);
  if (!built) return false;
  if (!store.load(built.parentSessionId)) return false;
  appendSessionEvent(store, built.parentSessionId, built.event);
  return true;
}
