/**
 * Runtime 侧 Todo notice / plan 辅助（从 AgentRuntime 抽出，行为不变）。
 */

import type { SessionStore } from "@little-house-studio/context";
import { appendSessionEvent, authorSystem } from "@little-house-studio/context";
import { TASK_MANAGER, formatTodoNoticeMessage } from "@little-house-studio/tools";
import { TODO_ORCHESTRATOR } from "./todo/index.js";

export function isTodoPlanSettled(sessionId: string): boolean {
  try {
    const root = TODO_ORCHESTRATOR.resolveRootSession(sessionId);
    const tasks = TASK_MANAGER.getTasks(root);
    if (tasks.length === 0) return false;
    return tasks.every(
      (t) =>
        t.status === "completed" ||
        t.status === "failed" ||
        t.status === "cancelled",
    );
  } catch {
    return false;
  }
}

/**
 * 将 TodoOrchestrator 待投递 notice 追加为靠后 user 消息（保护 prompt cache）。
 * 仅注入 targetSessionId === 当前 session 的条目；其余 requeue。
 */
export function flushTodoNotices(sessions: SessionStore, sessionId: string): number {
  try {
    const notices = TODO_ORCHESTRATOR.drainNotices(sessionId);
    if (notices.length === 0) return 0;
    let n = 0;
    const requeue: typeof notices = [];
    for (const notice of notices) {
      const target = notice.targetSessionId || sessionId;
      if (target === sessionId) {
        const body = formatTodoNoticeMessage(notice);
        appendSessionEvent(sessions, sessionId, {
          kind: "system_notice",
          content: body,
          source: "todo_notice",
          author: authorSystem("todo", "todo"),
          meta: { notice_kind: notice.kind, plan_id: notice.planId, lane_id: notice.laneId },
        });
        n++;
      } else {
        requeue.push(notice);
      }
    }
    TODO_ORCHESTRATOR.requeueNotices(sessionId, requeue);
    return n;
  } catch {
    return 0;
  }
}

/** 工具轮次后：flush notice + 空转催促 */
export function afterTodoTools(
  sessions: SessionStore,
  sessionId: string,
  hadToolCalls: boolean,
): void {
  flushTodoNotices(sessions, sessionId);
  try {
    TODO_ORCHESTRATOR.evaluateNudge(sessionId, sessionId, hadToolCalls);
    flushTodoNotices(sessions, sessionId);
  } catch {
    /* ignore */
  }
}
