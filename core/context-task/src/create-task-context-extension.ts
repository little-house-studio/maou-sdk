import { maouToLLMMessage, type MaouMessage } from "@little-house-studio/context-components";
import type {
  AfterCompressContext,
  ContextSchemeExtension,
  FoldContext,
  FoldResult,
} from "@little-house-studio/context";
import { assignTaskIds } from "./assign-task-ids.js";
import { foldTasksByMetadata } from "./task-fold.js";
import type { MaouTaskBlock, TaskPlanEntry, TaskSessionStore } from "./task-session-store.js";

export function createTaskContextExtension(
  taskStore: TaskSessionStore,
): ContextSchemeExtension {
  return {
    afterSync(history: MaouMessage[]): MaouMessage[] {
      return assignTaskIds(history);
    },
    fold(ctx: FoldContext): Promise<FoldResult | null> {
      return foldTasksByMetadata(ctx, taskStore);
    },
    afterCompress(ctx: AfterCompressContext): void {
      persistFoldedOriginals(taskStore, ctx);
    },
    onClearSession(sessionId: string): void {
      try {
        taskStore.saveTaskPlan(sessionId, []);
      } catch {
        /* 清盘失败不挡会话清空 */
      }
    },
  };
}

function persistFoldedOriginals(
  taskStore: TaskSessionStore,
  ctx: AfterCompressContext,
): void {
  const newBlockIds: string[] = [];
  for (const [taskId, originals] of ctx.foldedOriginals ?? []) {
    if (taskId === "__no_task__") continue;
    const llmMsgs = originals.map(maouToLLMMessage);
    taskStore.createTaskBlock(ctx.sessionId, taskId, "", []);
    for (const msg of llmMsgs) {
      taskStore.appendMessage(ctx.sessionId, taskId, msg);
    }
    newBlockIds.push(taskId);
  }
  if (newBlockIds.length === 0) return;
  const plan = taskStore.loadTaskPlan(ctx.sessionId);
  let changed = false;
  for (const todo of plan) {
    if (todo.status !== "completed") {
      const existing = new Set(todo.relatedBlockIds ?? []);
      const before = existing.size;
      for (const id of newBlockIds) existing.add(id);
      if (existing.size !== before) {
        todo.relatedBlockIds = [...existing];
        changed = true;
      }
    }
  }
  if (changed) taskStore.saveTaskPlan(ctx.sessionId, plan);
}

export function createTaskPlanPersist(taskStore: TaskSessionStore) {
  return (sessionId: string, tasks: TaskPlanEntry[]): void => {
    const existing = taskStore.loadTaskPlan(sessionId);
    const existingMap = new Map(existing.map((t) => [t.id, t.relatedBlockIds ?? []]));
    for (const t of tasks) {
      if (!t.relatedBlockIds) t.relatedBlockIds = [];
      const oldIds = existingMap.get(t.id) ?? [];
      for (const id of oldIds) {
        if (!t.relatedBlockIds.includes(id)) t.relatedBlockIds.push(id);
      }
    }
    taskStore.saveTaskPlan(sessionId, tasks);
  };
}

export function restoreTask(
  taskStore: TaskSessionStore,
  sessionId: string,
  taskId: string,
): MaouTaskBlock | null {
  return taskStore.getTaskBlock(sessionId, taskId);
}
