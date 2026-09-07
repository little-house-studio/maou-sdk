import { isHumanTurnKind, resolveSessionEventKind, type MaouMessage } from "@little-house-studio/context-components";

const NON_HUMAN_SOURCES = new Set([
  "hook",
  "injected",
  "empty_retry",
  "verification",
  "todo_notice",
  "message_bus",
  "terminal-notification",
  "runtime_control",
  "system_notice",
  "agent_message",
  "compact",
]);

export function assignTaskIds(messages: MaouMessage[]): MaouMessage[] {
  let currentTaskId = "";
  return messages.map((m) => {
    const src = String(m.source ?? "");
    const kind = resolveSessionEventKind({
      role: m.originalRole ?? (m.category === "user" ? "user" : m.category === "assistant" ? "assistant" : "system"),
      source: src,
    });
    const isHumanUser =
      m.category === "user" &&
      !NON_HUMAN_SOURCES.has(src) &&
      isHumanTurnKind(kind);
    if (isHumanUser) {
      currentTaskId = `t${m.seqId}`;
    }
    if (!currentTaskId) return m;
    if (m.taskIds.length > 0) return m;
    return { ...m, taskIds: [currentTaskId] };
  });
}

export function groupByTask(messages: MaouMessage[]): Map<string, MaouMessage[]> {
  const groups = new Map<string, MaouMessage[]>();
  for (const m of messages) {
    if (m.taskIds.length === 0) {
      const arr = groups.get("__no_task__") ?? [];
      arr.push(m);
      groups.set("__no_task__", arr);
    } else {
      for (const tid of m.taskIds) {
        const arr = groups.get(tid) ?? [];
        arr.push(m);
        groups.set(tid, arr);
      }
    }
  }
  return groups;
}
