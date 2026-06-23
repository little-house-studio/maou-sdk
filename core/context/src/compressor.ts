/**
 * 上下文压缩器 —— 五阶段分阶段自动压缩。
 *
 * 两个入口：
 *   compressMaou()    — async，操作 MaouMessage[]，支持可插拔 Summarizer（LLM 摘要）。
 *   maybeCompress()    — sync compat shim（truncate-only），保持旧签名兼容。
 *
 * 压缩阶段（按 token 占比逐步升级）：
 *   activeStage  : < 70% maxTokens，不压缩。
 *   compactStage : >= 70%，微压缩——对标注过或单条超长的消息生成摘要。
 *   summaryStage : 微压缩后仍 >= 80%，大压缩——按 task_id 生成摘要，原文落盘。
 *   archiveStage : 大压缩后仍 >= 90%，归档——只保留 task_id + 极简摘要。
 *   staticStage  : 静态阶段不参与压缩。
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
  CompressionStage,
  CompressionResult,
  TaskSummary,
} from "./types/compression.js";
import type { MaouMessage, MaouContent, LLMMessage } from "./types/message.js";
import { maouToLLMMessage } from "./types/message.js";
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
  /** 最大压缩阶段（逐级递进时限制只压到某一级） */
  maxStage?: CompressionStage;
}

export interface CompressMaouResult {
  history: MaouMessage[];
  stage: CompressionStage;
  droppedSummary: string;
  taskBlocks: string[];
  perTaskOriginals: Map<string, MaouMessage[]>;
  originalTokens: number;
  compressedTokens: number;
}

// ─── 新主入口（async，操作 MaouMessage[]） ─────────────────────────────────

const STAGE_ORDER: CompressionStage[] = [
  "activeStage",
  "compactStage",
  "summaryStage",
  "archiveStage",
];

function stageIndex(s: CompressionStage): number {
  return STAGE_ORDER.indexOf(s);
}

export async function compressMaou(
  history: MaouMessage[],
  opts: CompressOptions,
): Promise<CompressMaouResult> {
  const threshold = opts.maxTokens > 0 ? opts.maxTokens : 65536;
  const originalTokens = estimateTokens(history);
  const maxStageIdx = opts.maxStage ? stageIndex(opts.maxStage) : STAGE_ORDER.length - 1;

  const noChange = (): CompressMaouResult => ({
    history,
    stage: "activeStage",
    droppedSummary: "",
    taskBlocks: [],
    perTaskOriginals: new Map(),
    originalTokens,
    compressedTokens: originalTokens,
  });

  // activeStage
  if (originalTokens < Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100)) {
    return noChange();
  }

  // compactStage（微压缩）
  if (maxStageIdx < stageIndex("compactStage")) return noChange();
  const afterMicro = await microCompactAll(history, opts.summarizer);
  const microTokens = estimateTokens(afterMicro);
  if (microTokens < Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100)) {
    return {
      history: afterMicro,
      stage: "compactStage",
      droppedSummary: "",
      taskBlocks: [],
      perTaskOriginals: new Map(),
      originalTokens,
      compressedTokens: microTokens,
    };
  }

  // summaryStage（大压缩）
  if (maxStageIdx < stageIndex("summaryStage")) {
    // maxStage 限制在 compactStage，到此为止
    return {
      history: afterMicro,
      stage: "compactStage",
      droppedSummary: "",
      taskBlocks: [],
      perTaskOriginals: new Map(),
      originalTokens,
      compressedTokens: microTokens,
    };
  }
  const afterSummary = await summaryCompressHarness(afterMicro, opts.summarizer);
  const summaryTokens = estimateTokens(afterSummary.messages);
  if (summaryTokens < Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100)) {
    return {
      history: afterSummary.messages,
      stage: "summaryStage",
      droppedSummary: afterSummary.summary,
      taskBlocks: afterSummary.taskBlocks,
      perTaskOriginals: afterSummary.perTaskOriginals,
      originalTokens,
      compressedTokens: summaryTokens,
    };
  }

  // archiveStage（归档阶段）
  if (maxStageIdx < stageIndex("archiveStage")) {
    // maxStage 限制在 summaryStage，到此为止
    return {
      history: afterSummary.messages,
      stage: "summaryStage",
      droppedSummary: afterSummary.summary,
      taskBlocks: afterSummary.taskBlocks,
      perTaskOriginals: afterSummary.perTaskOriginals,
      originalTokens,
      compressedTokens: summaryTokens,
    };
  }
  const afterArchive = archiveCompressHarness(afterSummary);
  return {
    history: afterArchive.messages,
    stage: "archiveStage",
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
  const maou = messages.map((m, i) => rawToMaou(m, i));
  const originalTokens = estimateTokens(maou);
  const threshold = maxTokens > 0 ? maxTokens : 65536;

  if (originalTokens < Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100)) {
    return { messages, compressed: false, droppedSummary: "", stage: "activeStage", originalTokens, compressedTokens: originalTokens };
  }

  const afterMicro = microCompactAllSync(maou);
  const microTokens = estimateTokens(afterMicro);
  if (microTokens < Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100)) {
    return buildLegacyResult(afterMicro, originalTokens, "compactStage");
  }

  const afterSummary = summaryCompressSync(afterMicro);
  const summaryTokens = estimateTokens(afterSummary.messages);
  if (summaryTokens < Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100)) {
    return buildLegacyResult(afterSummary.messages, originalTokens, "summaryStage", afterSummary.summary, afterSummary.taskBlocks);
  }

  const afterArchive = archiveCompressHarness(afterSummary);
  return buildLegacyResult(afterArchive.messages, originalTokens, "archiveStage", afterArchive.summary, afterArchive.taskBlocks);
}

// ─── 微压缩（滑动窗口：从最新往前保留 N 条，超出的旧消息按标注压缩） ──────

/**
 * 微压缩 = 滑动窗口，不需要 LLM。
 *
 * 原理（对标 Claude Code Microcompact）：
 *   1. 从最新消息往前数，保留最近 N 条消息在动态区
 *   2. 超出窗口的旧消息，按标注（microCompact）压缩
 *   3. 没有标注的超长消息（>MICRO_SINGLE_MSG_CHARS）也自动压缩
 *   4. system/pinned/keepAfterCompress 的消息永远不压缩
 *
 * 方向：从末尾（最新）往前看，超出的部分压缩——和大压缩（从最老往前看）相反
 */
async function microCompactAll(messages: MaouMessage[], summarizer?: Summarizer): Promise<MaouMessage[]> {
  // 找到动态区边界：从末尾往前，累计 token 不超过阈值
  const activeBudget = Math.floor(messages.length * 0.4); // 保留最近 40% 的消息
  const boundary = Math.max(0, messages.length - activeBudget);

  const result: MaouMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    // 动态区内的消息不压缩
    if (i >= boundary) { result.push(m); continue; }
    // system/pinned/keepAfterCompress 永远不压缩
    if (shouldSkipCompress(m)) { result.push(m); continue; }
    // 已有微压缩摘要的跳过
    const hasSummary = m.contents.some(c => c.microCompact?.enabled && c.microCompact.summary);
    if (hasSummary) { result.push(m); continue; }

    const fullText = m.contents.map(c => c.text).join('\n');
    const hasMetaCompact = m.meta?.microCompact?.enabled === true;
    const shouldAutoCompact = hasMetaCompact || fullText.length > MICRO_SINGLE_MSG_CHARS;
    if (!shouldAutoCompact) { result.push(m); continue; }

    // 按标注压缩（不需要 LLM，直接用规则）
    const summary = compactByCategory(m);
    const newContents = [...m.contents];
    if (newContents.length > 0) {
      newContents[0] = { ...newContents[0], microCompact: { enabled: true, summary } };
    }
    result.push({ ...m, contents: newContents });
  }
  return result;
}

function microCompactAllSync(messages: MaouMessage[]): MaouMessage[] {
  const activeBudget = Math.floor(messages.length * 0.4);
  const boundary = Math.max(0, messages.length - activeBudget);

  return messages.map((m, i) => {
    if (i >= boundary) return m;
    if (shouldSkipCompress(m)) return m;
    const hasSummary = m.contents.some(c => c.microCompact?.enabled && c.microCompact.summary);
    if (hasSummary) return m;
    const fullText = m.contents.map(c => c.text).join('\n');
    const hasMetaCompact = m.meta?.microCompact?.enabled === true;
    const shouldAutoCompact = hasMetaCompact || fullText.length > MICRO_SINGLE_MSG_CHARS;
    if (!shouldAutoCompact) return m;
    const summary = compactByCategory(m);
    const newContents = [...m.contents];
    if (newContents.length > 0) {
      newContents[0] = { ...newContents[0], microCompact: { enabled: true, summary } };
    }
    return { ...m, contents: newContents };
  });
}

function shouldSkipCompress(m: MaouMessage): boolean {
  if (m.category === "system") return true;
  if (m.pinned || m.keepAfterCompress) return true;
  return false;
}

function compactByCategory(m: MaouMessage): string {
  const text = m.contents.map(c => c.text).join('\n');
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
  messages: MaouMessage[];
  summary: string;
  taskBlocks: string[];
  perTaskOriginals: Map<string, MaouMessage[]>;
}

async function summaryCompressHarness(messages: MaouMessage[], summarizer?: Summarizer): Promise<SummaryCompressResult> {
  const { systemMsgs, pinnedOrCritical, recentToolChain, compressible, recentToolMsgs } = partitionMessages(messages);
  const groups = groupByTask(compressible);
  const taskBlocks: string[] = [];
  const summaryLines: string[] = [];
  const perTaskOriginals = new Map<string, MaouMessage[]>();

  for (const [taskId, msgs] of groups) {
    perTaskOriginals.set(taskId, msgs);
    let taskSummaryText: string;
    if (summarizer) {
      try {
        const llmMsgs = msgs.map(maouToLLMMessage);
        taskSummaryText = await summarizer({ kind: 'task', taskId, messages: llmMsgs });
      } catch { taskSummaryText = summarizeTaskFallback(taskId, msgs).summary; }
    } else {
      taskSummaryText = summarizeTaskFallback(taskId, msgs).summary;
    }
    summaryLines.push(taskSummaryText);
    taskBlocks.push(taskId);
  }

  const summary = summaryLines.join("\n\n");
  const result: MaouMessage[] = [...systemMsgs, ...pinnedOrCritical, ...recentToolMsgs];
  if (summary.trim()) {
    result.splice(systemMsgs.length, 0, makeSummaryMessage(summary));
  }

  return {
    messages: result.sort((a, b) => a.seqId - b.seqId),
    summary: buildDroppedSummary(compressible, summary),
    taskBlocks,
    perTaskOriginals,
  };
}

function summaryCompressSync(messages: MaouMessage[]): SummaryCompressResult {
  const { systemMsgs, pinnedOrCritical, recentToolMsgs, compressible } = partitionMessages(messages);
  const groups = groupByTask(compressible);
  const taskBlocks: string[] = [];
  const summaryLines: string[] = [];
  const perTaskOriginals = new Map<string, MaouMessage[]>();

  for (const [taskId, msgs] of groups) {
    perTaskOriginals.set(taskId, msgs);
    summaryLines.push(summarizeTaskFallback(taskId, msgs).summary);
    taskBlocks.push(taskId);
  }

  const summary = summaryLines.join("\n\n");
  const result: MaouMessage[] = [...systemMsgs, ...pinnedOrCritical, ...recentToolMsgs];
  if (summary.trim()) {
    result.splice(systemMsgs.length, 0, makeSummaryMessage(summary));
  }

  return {
    messages: result.sort((a, b) => a.seqId - b.seqId),
    summary: buildDroppedSummary(compressible, summary),
    taskBlocks,
    perTaskOriginals,
  };
}

function partitionMessages(messages: MaouMessage[]) {
  const systemMsgs: MaouMessage[] = [];
  const pinnedOrCritical: MaouMessage[] = [];
  const compressible: MaouMessage[] = [];

  const protectedToolCallIds = new Set<string>();
  for (const m of messages) {
    if (m.toolCalls) for (const tc of m.toolCalls) if (tc.id) protectedToolCallIds.add(tc.id);
  }
  const recentToolChain = collectRecentToolChain(messages, protectedToolCallIds);

  for (const m of messages) {
    if (m.category === "system") systemMsgs.push(m);
    else if (m.pinned || m.keepAfterCompress) pinnedOrCritical.push(m);
    else if (recentToolChain.has(m.seqId)) { /* handled below */ }
    else compressible.push(m);
  }

  const recentToolMsgs = messages.filter(m => recentToolChain.has(m.seqId));
  return { systemMsgs, pinnedOrCritical, recentToolChain, compressible, recentToolMsgs };
}

function collectRecentToolChain(messages: MaouMessage[], protectedIds: Set<string>): Set<number> {
  const seqIds = new Set<number>();
  const RECENT_PAIRS = 2;
  let pairs = 0;
  for (let i = messages.length - 1; i >= 0 && pairs < RECENT_PAIRS; i--) {
    const m = messages[i];
    if (m.category === "tool_result") {
      seqIds.add(m.seqId);
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev.category !== "tool_call") continue;
        const matched = prev.toolCalls?.some(tc => tc.id && protectedIds.has(tc.id) && tc.id === m.toolCallId);
        if (matched) { seqIds.add(prev.seqId); pairs++; break; }
      }
    }
  }
  return seqIds;
}

// ─── 死阶段归档 ────────────────────────────────────────────────────────────────

function archiveCompressHarness(input: SummaryCompressResult): { messages: MaouMessage[]; summary: string; taskBlocks: string[] } {
  const systemMsgs = input.messages.filter(m => m.category === "system");
  const pinned = input.messages.filter(m => m.pinned || m.keepAfterCompress);
  const archiveText = `[已归档任务: ${input.taskBlocks.length} 个]\n${input.taskBlocks.map(id => `- ${id}`).join("\n")}`;
  return {
    messages: [...systemMsgs, makeSummaryMessage(archiveText), ...pinned],
    summary: archiveText,
    taskBlocks: input.taskBlocks,
  };
}

// ─── task_id 赋值（供 ContextEngine 调用） ──────────────────────────────────

export function assignTaskIds(messages: MaouMessage[]): MaouMessage[] {
  let currentTaskId = "";
  return messages.map(m => {
    if (m.category === "user" && m.source !== "hook" && m.source !== "injected") {
      currentTaskId = `t${m.seqId}`;
    }
    if (!currentTaskId) return m;
    if (m.taskIds.length > 0) return m;
    return { ...m, taskIds: [currentTaskId] };
  });
}

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function groupByTask(messages: MaouMessage[]): Map<string, MaouMessage[]> {
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

function summarizeTaskFallback(taskId: string, msgs: MaouMessage[]): TaskSummary {
  const userInputs: string[] = [];
  const assistantResponses: string[] = [];
  let toolCallCount = 0;
  let toolResultCount = 0;

  for (const m of msgs) {
    const text = m.contents.map(c => c.text).join('\n');
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
    taskId,
    status: "done",
    startTime: msgs[0]?.createdAt ?? new Date().toISOString(),
    summary: truncate(`[${taskId}] ${parts.join(" | ")}`, SUMMARY_MAX_CHARS),
    goal: "",
    outline: msgs.slice(0, 10).map(m => `- [${m.category}] ${truncate(m.contents.map(c => c.text).join('\n'), 50)}`),
  };
}

function buildDroppedSummary(dropped: MaouMessage[], taskSummary: string): string {
  if (dropped.length === 0) return "";
  const userSnippets: string[] = [];
  const assistantSnippets: string[] = [];
  let userCount = 0;
  let assistantCount = 0;

  for (const m of dropped) {
    const text = m.contents.map(c => c.text).join('\n').trim();
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

function makeSummaryMessage(summary: string): MaouMessage {
  return {
    seqId: -1,
    taskIds: [],
    contents: [{
      text:
        `<prior_context_summary>\n` +
        `以下是此前对话中被压缩掉的摘要，供参考以保持上下文连贯性：\n\n` +
        `${summary}\n` +
        `</prior_context_summary>`,
    }],
    keepAfterCompress: true,
    category: "injected",
    originalRole: "user",
  };
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

// ─── 旧签名辅助 ─────────────────────────────────────────────────────────────

function rawToMaou(raw: Record<string, unknown>, seqId: number): MaouMessage {
  const role = String(raw.role ?? "user");
  const content = extractText(raw.content);
  const pinned = Boolean(raw.pinned ?? false);

  let category: MaouMessage["category"];
  if (role === "system") category = "system";
  else if (role === "assistant") {
    const tc = raw.tool_calls as Array<Record<string, unknown>> | undefined;
    category = tc && tc.length > 0 ? "tool_call" : "assistant";
  } else if (role === "tool") category = "tool_result";
  else category = "user";

  const toolCalls = (category === "tool_call" || category === "assistant")
    ? normalizeToolCalls(raw.tool_calls as Array<Record<string, unknown>> | undefined)
    : undefined;

  const mmsg: MaouMessage = {
    seqId, taskIds: [], contents: [{ text: content }],
    keepAfterCompress: pinned, category, pinned,
    originalRole: role as MaouMessage["originalRole"],
  };
  if (typeof raw.tool_call_id === "string") mmsg.toolCallId = raw.tool_call_id;
  if (toolCalls && toolCalls.length > 0) mmsg.toolCalls = toolCalls;
  return mmsg;
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

function normalizeToolCalls(calls: Array<Record<string, unknown>> | undefined): MaouMessage["toolCalls"] {
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

function maouToRaw(mmsg: MaouMessage): Record<string, unknown> {
  const fullText = mmsg.contents.map(c => {
    if (c.microCompact?.enabled && c.microCompact.summary) return c.microCompact.summary;
    return c.text;
  }).join('\n');
  const out: Record<string, unknown> = {
    role: mmsg.originalRole ?? categoryToRole(mmsg.category),
    content: fullText,
  };
  if (mmsg.category === "tool_result" && mmsg.toolCallId) out.tool_call_id = mmsg.toolCallId;
  if (mmsg.toolCalls && mmsg.toolCalls.length > 0) {
    out.tool_calls = mmsg.toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } }));
  }
  if (mmsg.pinned) out.pinned = true;
  return out;
}

function categoryToRole(c: MaouMessage["category"]): string {
  switch (c) {
    case "user": case "injected": return "user";
    case "assistant": case "tool_call": return "assistant";
    case "tool_result": return "tool";
    case "system": return "system";
    default: return "user";
  }
}

function buildLegacyResult(maouOut: MaouMessage[], originalTokens: number, stage: CompressionStage, summary = "", taskBlocks: string[] = []): CompressResult {
  const rawOut = maouOut.map(maouToRaw);
  const compressedTokens = estimateTokens(maouOut);
  return {
    messages: rawOut, compressed: stage !== "activeStage", droppedSummary: summary,
    stage, originalTokens, compressedTokens, taskBlocks: taskBlocks.length > 0 ? taskBlocks : undefined,
  };
}

// ─── 对外透出 ────────────────────────────────────────────────────────────────

export type { CompressionStage, CompressionResult, TaskSummary };
export { estimateTokens, estimateTokensFromText } from "./token-estimate.js";
