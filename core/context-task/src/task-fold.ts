import {
  maouToLLMMessage,
  seqRangeOf,
  type MaouMessage,
} from "@little-house-studio/context-components";
import {
  makeSummaryMessage,
  type FoldContext,
  type FoldResult,
  type Summarizer,
} from "@little-house-studio/context";
import { groupByTask } from "./assign-task-ids.js";
import type { TaskSessionStore } from "./task-session-store.js";

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

function summarizeTaskFallback(taskId: string, msgs: MaouMessage[]): string {
  const userInputs: string[] = [];
  const assistantResponses: string[] = [];
  let toolCallCount = 0;
  let toolResultCount = 0;
  for (const m of msgs) {
    const text = m.contents.map((c) => c.text).join("\n");
    switch (m.category) {
      case "user":
        userInputs.push(truncate(text, 100));
        break;
      case "assistant":
        assistantResponses.push(truncate(text, 150));
        break;
      case "tool_call":
        toolCallCount++;
        break;
      case "tool_result":
        toolResultCount++;
        break;
    }
  }
  const parts: string[] = [];
  if (userInputs.length > 0) parts.push(`用户输入(${userInputs.length}): ${userInputs.slice(0, 3).join("; ")}`);
  if (assistantResponses.length > 0) parts.push(`助手回复(${assistantResponses.length}): ${assistantResponses.slice(0, 2).join("; ")}`);
  if (toolCallCount > 0) parts.push(`工具调用(${toolCallCount})`);
  if (toolResultCount > 0) parts.push(`工具结果(${toolResultCount})`);
  return truncate(`[${taskId}] ${parts.join(" | ")}`, 500);
}

export function makeTaskSummaryMessage(
  taskId: string,
  summary: string,
  originalMsgs: MaouMessage[],
): MaouMessage {
  const seqId = originalMsgs[0]?.seqId ?? -1;
  const msg: MaouMessage = {
    seqId,
    taskIds: [taskId],
    contents: [{
      text: `<task_summary task="${taskId}">\n${summary}\n</task_summary>`,
    }],
    keepAfterCompress: true,
    category: "injected",
    originalRole: "user",
  };
  const range = seqRangeOf(originalMsgs);
  if (range) msg.compact = { type: "major", summary, seqRange: range };
  return msg;
}

function collectActiveTaskIds(taskStore: TaskSessionStore, sessionId: string): string[] {
  const plan = taskStore.loadTaskPlan(sessionId);
  const activeTaskIds: string[] = [];
  for (const todo of plan) {
    if (todo.status !== "completed") {
      for (const id of todo.relatedBlockIds ?? []) {
        if (!activeTaskIds.includes(id)) activeTaskIds.push(id);
      }
    }
  }
  return activeTaskIds;
}

export async function foldTasksByMetadata(
  ctx: FoldContext,
  taskStore: TaskSessionStore,
): Promise<FoldResult | null> {
  if (ctx.stage === "archive") return foldTaskArchive(ctx);
  return foldTaskSummary(ctx, taskStore);
}

async function foldTaskSummary(
  ctx: FoldContext,
  taskStore: TaskSessionStore,
): Promise<FoldResult> {
  const groups = groupByTask(ctx.compressible);
  const activeTaskIds = ctx.sessionId ? collectActiveTaskIds(taskStore, ctx.sessionId) : [];
  const activeSet = new Set(activeTaskIds);
  const filterActive = activeSet.size > 0;
  const foldedOriginals = new Map<string, MaouMessage[]>();
  const perTaskSummaries = new Map<string, string>();
  const blockIds: string[] = [];
  const summaryLines: string[] = [];

  const entries = [...groups];
  const summaryResults = await Promise.all(entries.map(async ([taskId, msgs]) => {
    foldedOriginals.set(taskId, msgs);
    const text = await summarizeGroup(ctx.summarizer, taskId, msgs);
    return { taskId, msgs, summary: text };
  }));

  const replacement: MaouMessage[] = [];
  for (const { taskId, msgs, summary } of summaryResults) {
    perTaskSummaries.set(taskId, summary);
    summaryLines.push(summary);
    blockIds.push(taskId);
    if (!filterActive || activeSet.has(taskId)) {
      replacement.push(makeTaskSummaryMessage(taskId, summary, msgs));
    }
  }

  return {
    replacement,
    droppedSummary: summaryLines.join("\n\n"),
    foldedOriginals,
    blockIds,
    extras: { perTaskSummaries: Object.fromEntries(perTaskSummaries) },
  };
}

async function summarizeGroup(
  summarizer: Summarizer | undefined,
  taskId: string,
  msgs: MaouMessage[],
): Promise<string> {
  if (summarizer) {
    try {
      return await summarizer({
        kind: "task",
        taskId,
        messages: msgs.map(maouToLLMMessage),
      });
    } catch {
      /* 回退 */
    }
  }
  return summarizeTaskFallback(taskId, msgs);
}

function foldTaskArchive(ctx: FoldContext): FoldResult {
  const prior = ctx.prior;
  const blockIds = prior?.blockIds ?? [];
  const summaries = (prior?.extras?.perTaskSummaries ?? {}) as Record<string, string>;
  const activeRawSeqs = new Set<number>(
    Array.isArray(prior?.extras?.activeRawSeqs) ? (prior?.extras?.activeRawSeqs as number[]) : [],
  );
  const activeRaw = ctx.history.filter((m) => activeRawSeqs.has(m.seqId));
  const systemMsgs = ctx.history.filter((m) => m.category === "system");
  const pinned = ctx.history.filter(
    (m) =>
      (m.pinned || m.keepAfterCompress) &&
      !activeRaw.some((a) => a.seqId === m.seqId),
  );
  const archiveLines: string[] = [`[已归档任务: ${blockIds.length} 个]`];
  for (const taskId of blockIds) {
    const summary = summaries[taskId] ?? "";
    const snippet = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
    archiveLines.push(`- ${taskId}: ${snippet}`);
  }
  const archiveText = archiveLines.join("\n");
  return {
    replacement: [
      ...systemMsgs,
      makeSummaryMessage(archiveText),
      ...pinned,
      ...activeRaw.filter((m) => !pinned.some((p) => p.seqId === m.seqId)),
    ].sort((a, b) => a.seqId - b.seqId),
    droppedSummary: archiveText,
    foldedOriginals: prior?.foldedOriginals,
    blockIds,
  };
}
