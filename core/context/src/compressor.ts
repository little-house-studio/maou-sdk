/**
 * 上下文压缩器 —— 五区分阶段自动压缩。
 *
 * 两个入口：
 *   compressHarness()  — async，操作 HarnessMessage[]，支持可插拔 Summarizer（LLM 摘要）。
 *   maybeCompress()    — sync compat shim（truncate-only），保持旧签名兼容。
 *
 * 压缩阶段（按 token 占比逐步升级）：
 *   active_zone  : < 70% maxTokens，不压缩。
 *   compact_zone : >= 70%，微压缩——对标注过或单条超长的消息生成摘要。
 *   summary_zone : 微压缩后仍 >= 80%，大压缩——按 task_id 生成摘要，原文落盘。
 *   archive_zone : 大压缩后仍 >= 90%，归档——只保留 task_id + 极简摘要。
 *   static_zone  : 静态区不参与压缩。
 */

import {
  MICRO_TRIGGER_PERCENT,
  SUMMARY_TRIGGER_PERCENT,
  ARCHIVE_TRIGGER_PERCENT,
  MICRO_SINGLE_MSG_CHARS,
  MICRO_SUMMARY_MAX_CHARS,
  SUMMARY_MAX_CHARS,
  SUMMARY_SNIPPET_MAX_CHARS,
  SUMMARY_MAX_ENTRIES_PER_ROLE,
} from "./constants.js";
import type { CompressResult } from "./types.js";
import type {
  CompressionZone,
  CompressionResult,
  TaskSummary,
} from "./types/compression.js";
import type { HarnessMessage, LLMMessage } from "./types/message.js";
import { harnessToLLMMessage } from "./types/message.js";
import { estimateTokens, estimateTokensFromText } from "./token-estimate.js";

// ─── 可插拔摘要器 ────────────────────────────────────────────────────────────

export type Summarizer = (input: {
  kind: 'task' | 'micro';
  taskId?: string;
  messages: LLMMessage[];
}) => Promise<string>;

export interface CompressOptions {
  maxTokens: number;
  summarizer?: Summarizer;
  sessionId?: string;
}

export interface CompressHarnessResult {
  history: HarnessMessage[];
  zone: CompressionZone;
  droppedSummary: string;
  taskBlocks: string[];
  perTaskOriginals: Map<string, HarnessMessage[]>;
  originalTokens: number;
  compressedTokens: number;
}

// ─── 新主入口（async，操作 HarnessMessage[]） ─────────────────────────────────

export async function compressHarness(
  history: HarnessMessage[],
  opts: CompressOptions,
): Promise<CompressHarnessResult> {
  const threshold = opts.maxTokens > 0 ? opts.maxTokens : 65536;
  const originalTokens = estimateTokens(history);

  const noChange = (): CompressHarnessResult => ({
    history,
    zone: "active_zone",
    droppedSummary: "",
    taskBlocks: [],
    perTaskOriginals: new Map(),
    originalTokens,
    compressedTokens: originalTokens,
  });

  // active_zone
  if (originalTokens < Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100)) {
    return noChange();
  }

  // compact_zone（微压缩）
  const afterMicro = await microCompactAll(history, opts.summarizer);
  const microTokens = estimateTokens(afterMicro);
  if (microTokens < Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100)) {
    return {
      history: afterMicro,
      zone: "compact_zone",
      droppedSummary: "",
      taskBlocks: [],
      perTaskOriginals: new Map(),
      originalTokens,
      compressedTokens: microTokens,
    };
  }

  // summary_zone（大压缩）
  const afterSummary = await summaryCompressHarness(afterMicro, opts.summarizer);
  const summaryTokens = estimateTokens(afterSummary.messages);
  if (summaryTokens < Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100)) {
    return {
      history: afterSummary.messages,
      zone: "summary_zone",
      droppedSummary: afterSummary.summary,
      taskBlocks: afterSummary.taskBlocks,
      perTaskOriginals: afterSummary.perTaskOriginals,
      originalTokens,
      compressedTokens: summaryTokens,
    };
  }

  // archive_zone（死区）
  const afterArchive = archiveCompressHarness(afterSummary);
  return {
    history: afterArchive.messages,
    zone: "archive_zone",
    droppedSummary: afterArchive.summary,
    taskBlocks: afterArchive.taskBlocks,
    perTaskOriginals: afterSummary.perTaskOriginals,
    originalTokens,
    compressedTokens: estimateTokens(afterArchive.messages),
  };
}

// ─── 旧签名 compat shim（sync，truncate-only） ──────────────────────────────

export function maybeCompress(
  messages: Record<string, unknown>[],
  maxTokens: number,
): CompressResult {
  const harness = messages.map((m, i) => rawToHarness(m, i));
  const originalTokens = estimateTokens(harness);
  const threshold = maxTokens > 0 ? maxTokens : 65536;

  if (originalTokens < Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100)) {
    return { messages, compressed: false, droppedSummary: "", zone: "active_zone", originalTokens, compressedTokens: originalTokens };
  }

  const afterMicro = microCompactAllSync(harness);
  const microTokens = estimateTokens(afterMicro);
  if (microTokens < Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100)) {
    return buildLegacyResult(afterMicro, originalTokens, "compact_zone");
  }

  const afterSummary = summaryCompressSync(afterMicro);
  const summaryTokens = estimateTokens(afterSummary.messages);
  if (summaryTokens < Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100)) {
    return buildLegacyResult(afterSummary.messages, originalTokens, "summary_zone", afterSummary.summary, afterSummary.taskBlocks);
  }

  const afterArchive = archiveCompressHarness(afterSummary);
  return buildLegacyResult(afterArchive.messages, originalTokens, "archive_zone", afterArchive.summary, afterArchive.taskBlocks);
}

// ─── 微压缩 ──────────────────────────────────────────────────────────────────

async function microCompactAll(messages: HarnessMessage[], summarizer?: Summarizer): Promise<HarnessMessage[]> {
  const result: HarnessMessage[] = [];
  for (const m of messages) {
    if (shouldSkipCompress(m)) { result.push(m); continue; }
    // 检查是否已有微压缩摘要
    const hasSummary = m.contents.some(c => c.micro_compact?.enabled && c.micro_compact.summary);
    if (hasSummary) { result.push(m); continue; }
    const fullText = m.contents.map(c => c.text_content).join('\n');
    const hasMetaCompact = m.meta?.microCompact?.enabled === true;
    const shouldAutoCompact = hasMetaCompact || fullText.length > MICRO_SINGLE_MSG_CHARS;
    if (!shouldAutoCompact) { result.push(m); continue; }

    let summary: string;
    if (summarizer) {
      try {
        summary = await summarizer({ kind: 'micro', messages: [harnessToLLMMessage(m)] });
      } catch { summary = compactByCategory(m); }
    } else {
      summary = compactByCategory(m);
    }
    // 对第一个内容块设置微压缩摘要
    const newContents = [...m.contents];
    if (newContents.length > 0) {
      newContents[0] = { ...newContents[0], micro_compact: { enabled: true, summary } };
    }
    result.push({ ...m, contents: newContents });
  }
  return result;
}

function microCompactAllSync(messages: HarnessMessage[]): HarnessMessage[] {
  return messages.map(m => {
    if (shouldSkipCompress(m)) return m;
    const hasSummary = m.contents.some(c => c.micro_compact?.enabled && c.micro_compact.summary);
    if (hasSummary) return m;
    const fullText = m.contents.map(c => c.text_content).join('\n');
    const hasMetaCompact = m.meta?.microCompact?.enabled === true;
    const shouldAutoCompact = hasMetaCompact || fullText.length > MICRO_SINGLE_MSG_CHARS;
    if (!shouldAutoCompact) return m;
    const summary = compactByCategory(m);
    const newContents = [...m.contents];
    if (newContents.length > 0) {
      newContents[0] = { ...newContents[0], micro_compact: { enabled: true, summary } };
    }
    return { ...m, contents: newContents };
  });
}

function shouldSkipCompress(m: HarnessMessage): boolean {
  if (m.category === "system") return true;
  if (m.pinned || m.keep_after_compress) return true;
  return false;
}

function compactByCategory(m: HarnessMessage): string {
  const text = m.contents.map(c => c.text_content).join('\n');
  switch (m.category) {
    case "user": return `[用户] ${truncate(text, MICRO_SUMMARY_MAX_CHARS)}`;
    case "assistant": {
      const firstLine = text.split("\n").find(l => l.trim() && !l.trim().startsWith("#")) || text.split("\n")[0] || "";
      return `[助手] ${truncate(firstLine, MICRO_SUMMARY_MAX_CHARS)}`;
    }
    case "tool_call": return `[工具调用] ${truncate(text, 50)}`;
    case "tool_result": return `[工具结果] ${truncate(text, 50)}`;
    case "injected": return `[注入] ${truncate(text, 50)}`;
    default: return truncate(text, MICRO_SUMMARY_MAX_CHARS);
  }
}

// ─── 大压缩 ──────────────────────────────────────────────────────────────────

interface SummaryCompressResult {
  messages: HarnessMessage[];
  summary: string;
  taskBlocks: string[];
  perTaskOriginals: Map<string, HarnessMessage[]>;
}

async function summaryCompressHarness(messages: HarnessMessage[], summarizer?: Summarizer): Promise<SummaryCompressResult> {
  const { systemMsgs, pinnedOrCritical, recentToolChain, compressible, recentToolMsgs } = partitionMessages(messages);
  const groups = groupByTask(compressible);
  const taskBlocks: string[] = [];
  const summaryLines: string[] = [];
  const perTaskOriginals = new Map<string, HarnessMessage[]>();

  for (const [taskId, msgs] of groups) {
    perTaskOriginals.set(taskId, msgs);
    let taskSummaryText: string;
    if (summarizer) {
      try {
        const llmMsgs = msgs.map(harnessToLLMMessage);
        taskSummaryText = await summarizer({ kind: 'task', taskId, messages: llmMsgs });
      } catch { taskSummaryText = summarizeTaskFallback(taskId, msgs).summary; }
    } else {
      taskSummaryText = summarizeTaskFallback(taskId, msgs).summary;
    }
    summaryLines.push(taskSummaryText);
    taskBlocks.push(taskId);
  }

  const summary = summaryLines.join("\n\n");
  const result: HarnessMessage[] = [...systemMsgs, ...pinnedOrCritical, ...recentToolMsgs];
  if (summary.trim()) {
    result.splice(systemMsgs.length, 0, makeSummaryMessage(summary));
  }

  return {
    messages: result.sort((a, b) => a.seq_id - b.seq_id),
    summary: buildDroppedSummary(compressible, summary),
    taskBlocks,
    perTaskOriginals,
  };
}

function summaryCompressSync(messages: HarnessMessage[]): SummaryCompressResult {
  const { systemMsgs, pinnedOrCritical, recentToolMsgs, compressible } = partitionMessages(messages);
  const groups = groupByTask(compressible);
  const taskBlocks: string[] = [];
  const summaryLines: string[] = [];
  const perTaskOriginals = new Map<string, HarnessMessage[]>();

  for (const [taskId, msgs] of groups) {
    perTaskOriginals.set(taskId, msgs);
    summaryLines.push(summarizeTaskFallback(taskId, msgs).summary);
    taskBlocks.push(taskId);
  }

  const summary = summaryLines.join("\n\n");
  const result: HarnessMessage[] = [...systemMsgs, ...pinnedOrCritical, ...recentToolMsgs];
  if (summary.trim()) {
    result.splice(systemMsgs.length, 0, makeSummaryMessage(summary));
  }

  return {
    messages: result.sort((a, b) => a.seq_id - b.seq_id),
    summary: buildDroppedSummary(compressible, summary),
    taskBlocks,
    perTaskOriginals,
  };
}

function partitionMessages(messages: HarnessMessage[]) {
  const systemMsgs: HarnessMessage[] = [];
  const pinnedOrCritical: HarnessMessage[] = [];
  const compressible: HarnessMessage[] = [];

  const protectedToolCallIds = new Set<string>();
  for (const m of messages) {
    if (m.tool_calls) for (const tc of m.tool_calls) if (tc.id) protectedToolCallIds.add(tc.id);
  }
  const recentToolChain = collectRecentToolChain(messages, protectedToolCallIds);

  for (const m of messages) {
    if (m.category === "system") systemMsgs.push(m);
    else if (m.pinned || m.keep_after_compress) pinnedOrCritical.push(m);
    else if (recentToolChain.has(m.seq_id)) { /* handled below */ }
    else compressible.push(m);
  }

  const recentToolMsgs = messages.filter(m => recentToolChain.has(m.seq_id));
  return { systemMsgs, pinnedOrCritical, recentToolChain, compressible, recentToolMsgs };
}

function collectRecentToolChain(messages: HarnessMessage[], protectedIds: Set<string>): Set<number> {
  const seqIds = new Set<number>();
  const RECENT_PAIRS = 2;
  let pairs = 0;
  for (let i = messages.length - 1; i >= 0 && pairs < RECENT_PAIRS; i--) {
    const m = messages[i];
    if (m.category === "tool_result") {
      seqIds.add(m.seq_id);
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev.category !== "tool_call") continue;
        const matched = prev.tool_calls?.some(tc => tc.id && protectedIds.has(tc.id) && tc.id === m.tool_call_id);
        if (matched) { seqIds.add(prev.seq_id); pairs++; break; }
      }
    }
  }
  return seqIds;
}

// ─── 死区归档 ────────────────────────────────────────────────────────────────

function archiveCompressHarness(input: SummaryCompressResult): { messages: HarnessMessage[]; summary: string; taskBlocks: string[] } {
  const systemMsgs = input.messages.filter(m => m.category === "system");
  const pinned = input.messages.filter(m => m.pinned || m.keep_after_compress);
  const archiveText = `[已归档任务: ${input.taskBlocks.length} 个]\n${input.taskBlocks.map(id => `- ${id}`).join("\n")}`;
  return {
    messages: [...systemMsgs, makeSummaryMessage(archiveText), ...pinned],
    summary: archiveText,
    taskBlocks: input.taskBlocks,
  };
}

// ─── task_id 赋值（供 ContextEngine 调用） ──────────────────────────────────

export function assignTaskIds(messages: HarnessMessage[]): HarnessMessage[] {
  let currentTaskId = "";
  return messages.map(m => {
    if (m.category === "user" && m.source !== "hook" && m.source !== "injected") {
      currentTaskId = `t${m.seq_id}`;
    }
    if (!currentTaskId) return m;
    if (m.task_ids.length > 0) return m;
    return { ...m, task_ids: [currentTaskId] };
  });
}

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function groupByTask(messages: HarnessMessage[]): Map<string, HarnessMessage[]> {
  const groups = new Map<string, HarnessMessage[]>();
  for (const m of messages) {
    if (m.task_ids.length === 0) {
      const arr = groups.get("__no_task__") ?? [];
      arr.push(m);
      groups.set("__no_task__", arr);
    } else {
      for (const tid of m.task_ids) {
        const arr = groups.get(tid) ?? [];
        arr.push(m);
        groups.set(tid, arr);
      }
    }
  }
  return groups;
}

function summarizeTaskFallback(taskId: string, msgs: HarnessMessage[]): TaskSummary {
  const userInputs: string[] = [];
  const assistantResponses: string[] = [];
  let toolCallCount = 0;
  let toolResultCount = 0;

  for (const m of msgs) {
    const text = m.contents.map(c => c.text_content).join('\n');
    switch (m.category) {
      case "user": userInputs.push(truncate(text, 100)); break;
      case "assistant": assistantResponses.push(truncate(text, 150)); break;
      case "tool_call": toolCallCount++; break;
      case "tool_result": toolResultCount++; break;
    }
  }

  const parts: string[] = [];
  if (userInputs.length > 0) parts.push(`用户输入(${userInputs.length}): ${userInputs.slice(0, 3).join("; ")}`);
  if (assistantResponses.length > 0) parts.push(`助手回复(${assistantResponses.length}): ${assistantResponses.slice(0, 2).join("; ")}`);
  if (toolCallCount > 0) parts.push(`工具调用(${toolCallCount})`);
  if (toolResultCount > 0) parts.push(`工具结果(${toolResultCount})`);

  return {
    task_id: taskId,
    status: "done",
    start_time: msgs[0]?.created_at ?? new Date().toISOString(),
    summary: truncate(`[${taskId}] ${parts.join(" | ")}`, SUMMARY_MAX_CHARS),
    goal: "",
    outline: msgs.slice(0, 10).map(m => `- [${m.category}] ${truncate(m.contents.map(c => c.text_content).join('\n'), 50)}`),
  };
}

function buildDroppedSummary(dropped: HarnessMessage[], taskSummary: string): string {
  if (dropped.length === 0) return "";
  const userSnippets: string[] = [];
  const assistantSnippets: string[] = [];
  let userCount = 0;
  let assistantCount = 0;

  for (const m of dropped) {
    const text = m.contents.map(c => c.text_content).join('\n').trim();
    if (!text) continue;
    if (m.category === "user") {
      userCount++;
      userSnippets.push(text.length > SUMMARY_SNIPPET_MAX_CHARS ? text.slice(0, SUMMARY_SNIPPET_MAX_CHARS) + "…" : text);
    } else if (m.category === "assistant") {
      assistantCount++;
      assistantSnippets.push(text.length > SUMMARY_SNIPPET_MAX_CHARS ? text.slice(0, SUMMARY_SNIPPET_MAX_CHARS) + "…" : text);
    }
  }

  const lines: string[] = [];
  lines.push(`[被压缩掉的历史：${userCount} 条 user + ${assistantCount} 条 assistant]`);
  if (taskSummary.trim()) lines.push("\n任务摘要：\n" + taskSummary);
  if (userSnippets.length > 0) {
    lines.push("用户此前说过：");
    for (const s of userSnippets.slice(0, SUMMARY_MAX_ENTRIES_PER_ROLE)) lines.push(`- ${s}`);
    if (userSnippets.length > SUMMARY_MAX_ENTRIES_PER_ROLE) lines.push(`- …（另 ${userSnippets.length - SUMMARY_MAX_ENTRIES_PER_ROLE} 条略）`);
  }
  if (assistantSnippets.length > 0) {
    lines.push("助手此前答复要点：");
    for (const s of assistantSnippets.slice(0, SUMMARY_MAX_ENTRIES_PER_ROLE)) lines.push(`- ${s}`);
    if (assistantSnippets.length > SUMMARY_MAX_ENTRIES_PER_ROLE) lines.push(`- …（另 ${assistantSnippets.length - SUMMARY_MAX_ENTRIES_PER_ROLE} 条略）`);
  }
  return lines.join("\n");
}

function makeSummaryMessage(summary: string): HarnessMessage {
  return {
    seq_id: -1,
    task_ids: [],
    contents: [{
      text_content:
        `<prior_context_summary>\n` +
        `以下是此前对话中被压缩掉的摘要，供参考以保持上下文连贯性：\n\n` +
        `${summary}\n` +
        `</prior_context_summary>`,
    }],
    keep_after_compress: true,
    category: "injected",
    original_role: "user",
  };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

// ─── 旧签名辅助 ─────────────────────────────────────────────────────────────

function rawToHarness(raw: Record<string, unknown>, seqId: number): HarnessMessage {
  const role = String(raw.role ?? "user");
  const content = extractText(raw.content);
  const pinned = Boolean(raw.pinned ?? false);

  let category: HarnessMessage["category"];
  if (role === "system") category = "system";
  else if (role === "assistant") {
    const tc = raw.tool_calls as Array<Record<string, unknown>> | undefined;
    category = tc && tc.length > 0 ? "tool_call" : "assistant";
  } else if (role === "tool") category = "tool_result";
  else category = "user";

  const toolCalls = (category === "tool_call" || category === "assistant")
    ? normalizeToolCalls(raw.tool_calls as Array<Record<string, unknown>> | undefined)
    : undefined;

  const hmsg: HarnessMessage = {
    seq_id: seqId, task_ids: [], contents: [{ text_content: content }],
    keep_after_compress: pinned, category, pinned,
    original_role: role as HarnessMessage["original_role"],
  };
  if (typeof raw.tool_call_id === "string") hmsg.tool_call_id = raw.tool_call_id;
  if (toolCalls && toolCalls.length > 0) hmsg.tool_calls = toolCalls;
  return hmsg;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in (part as Record<string, unknown>)) return String((part as { text?: unknown }).text ?? "");
      return "";
    }).join("");
  }
  return "";
}

function normalizeToolCalls(calls: Array<Record<string, unknown>> | undefined): HarnessMessage["tool_calls"] {
  if (!calls || calls.length === 0) return undefined;
  return calls.map(c => {
    const fn = (c.function ?? c) as Record<string, unknown>;
    const id = String(c.id ?? "");
    const name = String(fn.name ?? c.name ?? "");
    const argsRaw = fn.arguments ?? c.arguments ?? {};
    let argumentsObj: Record<string, unknown> = {};
    if (typeof argsRaw === "string") { try { argumentsObj = JSON.parse(argsRaw); } catch { argumentsObj = { raw: argsRaw }; } }
    else if (argsRaw && typeof argsRaw === "object") argumentsObj = argsRaw as Record<string, unknown>;
    return { id, name, arguments: argumentsObj };
  }).filter(c => c.id && c.name);
}

function harnessToRaw(hmsg: HarnessMessage): Record<string, unknown> {
  const fullText = hmsg.contents.map(c => {
    if (c.micro_compact?.enabled && c.micro_compact.summary) return c.micro_compact.summary;
    return c.text_content;
  }).join('\n');
  const out: Record<string, unknown> = {
    role: hmsg.original_role ?? categoryToRole(hmsg.category),
    content: fullText,
  };
  if (hmsg.category === "tool_result" && hmsg.tool_call_id) out.tool_call_id = hmsg.tool_call_id;
  if (hmsg.tool_calls && hmsg.tool_calls.length > 0) {
    out.tool_calls = hmsg.tool_calls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } }));
  }
  if (hmsg.pinned) out.pinned = true;
  return out;
}

function categoryToRole(c: HarnessMessage["category"]): string {
  switch (c) {
    case "user": case "injected": return "user";
    case "assistant": case "tool_call": return "assistant";
    case "tool_result": return "tool";
    case "system": return "system";
    default: return "user";
  }
}

function buildLegacyResult(harnessOut: HarnessMessage[], originalTokens: number, zone: CompressionZone, summary = "", taskBlocks: string[] = []): CompressResult {
  const rawOut = harnessOut.map(harnessToRaw);
  const compressedTokens = estimateTokens(harnessOut);
  return {
    messages: rawOut, compressed: zone !== "active_zone", droppedSummary: summary,
    zone, originalTokens, compressedTokens, taskBlocks: taskBlocks.length > 0 ? taskBlocks : undefined,
  };
}

// ─── 对外透出 ────────────────────────────────────────────────────────────────

export type { CompressionZone, CompressionResult, TaskSummary };
export { estimateTokens, estimateTokensFromText } from "./token-estimate.js";
