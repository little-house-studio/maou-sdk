/**
 * 上下文压缩器 —— 五区分阶段自动压缩。
 *
 * 层级归属：上下文层（core/context）。只感知消息结构，不感知 agent 循环与 LLM 调用。
 *
 * 压缩阶段（按 token 占比逐步升级）：
 *   active_zone  : < 70% maxTokens，不压缩。
 *   compact_zone : >= 70%，微压缩——对标注过或单条超长的消息生成摘要。
 *   summary_zone : 微压缩后仍 >= 80%，大压缩——按 task_id 生成摘要，产出任务块 ID 列表。
 *   archive_zone : 大压缩后仍 >= 90%，归档——只保留任务块 ID + 极简摘要。
 *   static_zone  : 静态区不参与压缩。
 *
 * 输入输出均为 `Record<string, unknown>[]`（LLM 层原始消息格式），
 * 内部转换为 `HarnessMessage[]` 执行算法，转换回 LLM 格式返回。
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
import type { HarnessMessage } from "./types/message.js";

// ─── 类型桥接 ────────────────────────────────────────────────────────────────

/** 把 LLM 层原始消息对象转为 HarnessMessage（内部算法使用） */
function rawToHarness(raw: Record<string, unknown>, seqId: number): HarnessMessage {
  const role = String(raw.role ?? "user");
  const content = extractText(raw.content);
  const pinned = Boolean(raw.pinned ?? false);
  const priorityRaw = String(raw.priority ?? "normal");
  const priority: HarnessMessage["priority"] =
    priorityRaw === "critical" || priorityRaw === "important"
      ? (priorityRaw as HarnessMessage["priority"])
      : "normal";

  let category: HarnessMessage["category"];
  if (role === "system") category = "system";
  else if (role === "assistant") {
    const tc = raw.tool_calls as Array<Record<string, unknown>> | undefined;
    category = tc && tc.length > 0 ? "tool_call" : "assistant";
  } else if (role === "tool") {
    category = "tool_result";
  } else {
    category = "user";
  }

  const toolCalls =
    category === "tool_call" || category === "assistant"
      ? normalizeToolCalls(raw.tool_calls as Array<Record<string, unknown>> | undefined)
      : undefined;

  const hmsg: HarnessMessage = {
    seq_id: seqId,
    task_ids: [],
    content: { text_content: content },
    keep_after_compress: pinned,
    category,
    priority,
    pinned,
    original_role: role as HarnessMessage["original_role"],
  };
  if (typeof raw.tool_call_id === "string") hmsg.tool_call_id = raw.tool_call_id;
  if (toolCalls && toolCalls.length > 0) hmsg.tool_calls = toolCalls;
  return hmsg;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in (part as Record<string, unknown>)) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function normalizeToolCalls(
  calls: Array<Record<string, unknown>> | undefined,
): HarnessMessage["tool_calls"] {
  if (!calls || calls.length === 0) return undefined;
  return calls
    .map((c) => {
      const fn = (c.function ?? c) as Record<string, unknown>;
      const id = String(c.id ?? "");
      const name = String(fn.name ?? c.name ?? "");
      const argsRaw = fn.arguments ?? c.arguments ?? {};
      let argumentsObj: Record<string, unknown> = {};
      if (typeof argsRaw === "string") {
        try {
          argumentsObj = JSON.parse(argsRaw);
        } catch {
          argumentsObj = { raw: argsRaw };
        }
      } else if (argsRaw && typeof argsRaw === "object") {
        argumentsObj = argsRaw as Record<string, unknown>;
      }
      return { id, name, arguments: argumentsObj };
    })
    .filter((c) => c.id && c.name);
}

/** 把 HarnessMessage 转回 LLM 层原始消息对象 */
function harnessToRaw(hmsg: HarnessMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: hmsg.original_role ?? categoryToRole(hmsg.category),
    content: hmsg.content.text_content,
  };
  if (hmsg.category === "tool_result" && hmsg.tool_call_id) {
    out.tool_call_id = hmsg.tool_call_id;
  }
  if (hmsg.tool_calls && hmsg.tool_calls.length > 0) {
    out.tool_calls = hmsg.tool_calls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    }));
  }
  if (hmsg.pinned) out.pinned = true;
  if (hmsg.priority && hmsg.priority !== "normal") out.priority = hmsg.priority;
  return out;
}

function categoryToRole(c: HarnessMessage["category"]): string {
  switch (c) {
    case "user":
    case "injected":
      return "user";
    case "assistant":
    case "tool_call":
      return "assistant";
    case "tool_result":
      return "tool";
    case "system":
      return "system";
    default:
      return "user";
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 检查是否需要压缩并按阶段执行。
 *
 * @param messages LLM 层原始消息数组
 * @param maxTokens 上下文 token 上限
 * @returns 压缩结果：messages（压缩后）、compressed、droppedSummary、zone、token 计数
 */
export function maybeCompress(
  messages: Record<string, unknown>[],
  maxTokens: number,
): CompressResult {
  const harness = messages.map((m, i) => rawToHarness(m, i));
  const originalTokens = estimateTokens(harness);
  const threshold = maxTokens > 0 ? maxTokens : 65536;

  // ── active_zone：未达阈值，原样返回
  const activeThreshold = Math.floor((threshold * MICRO_TRIGGER_PERCENT) / 100);
  if (originalTokens < activeThreshold) {
    return {
      messages,
      compressed: false,
      droppedSummary: "",
      zone: "active_zone",
      originalTokens,
      compressedTokens: originalTokens,
    };
  }

  // ── compact_zone：微压缩
  const afterMicro = microCompactAll(harness);
  const microTokens = estimateTokens(afterMicro);
  const summaryThreshold = Math.floor((threshold * SUMMARY_TRIGGER_PERCENT) / 100);
  if (microTokens < summaryThreshold) {
    return buildResult(afterMicro, originalTokens, "compact_zone");
  }

  // ── summary_zone：大压缩（按 task_id 摘要）
  const afterSummary = summaryCompress(afterMicro);
  const summaryTokens = estimateTokens(afterSummary.messages);
  const archiveThreshold = Math.floor((threshold * ARCHIVE_TRIGGER_PERCENT) / 100);
  if (summaryTokens < archiveThreshold) {
    return buildResult(
      afterSummary.messages,
      originalTokens,
      "summary_zone",
      afterSummary.summary,
      afterSummary.taskBlocks,
    );
  }

  // ── archive_zone：归档（极端场景）
  const afterArchive = archiveCompress(afterSummary);
  return buildResult(
    afterArchive.messages,
    originalTokens,
    "archive_zone",
    afterArchive.summary,
    afterArchive.taskBlocks,
  );
}

// ─── 阶段实现 ────────────────────────────────────────────────────────────────

/** 微压缩：扫所有消息，标注过或超长的生成摘要 */
function microCompactAll(messages: HarnessMessage[]): HarnessMessage[] {
  return messages.map((m) => {
    if (shouldSkipCompress(m)) return m;

    const text = m.content.text_content;
    const alreadySummarized =
      m.content.micro_compact?.enabled && m.content.micro_compact.summary;

    if (alreadySummarized) {
      return {
        ...m,
        content: {
          ...m.content,
          text_content: m.content.micro_compact!.summary!,
        },
      };
    }

    const shouldAutoCompact =
      m.micro_compact_config?.enabled === true ||
      text.length > MICRO_SINGLE_MSG_CHARS;
    if (!shouldAutoCompact) return m;

    const summary = compactByCategory(m);
    return {
      ...m,
      content: {
        ...m.content,
        text_content: summary,
        micro_compact: { enabled: true, summary },
      },
    };
  });
}

/** 永不压缩的消息：system / pinned / 极短消息 */
function shouldSkipCompress(m: HarnessMessage): boolean {
  if (m.category === "system") return true;
  if (m.pinned || m.keep_after_compress) return true;
  if (m.priority === "critical") return true;
  return false;
}

function compactByCategory(m: HarnessMessage): string {
  const text = m.content.text_content;
  switch (m.category) {
    case "user":
      return `[用户] ${truncate(text, MICRO_SUMMARY_MAX_CHARS)}`;
    case "assistant": {
      const firstLine =
        text.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) ||
        text.split("\n")[0] ||
        "";
      return `[助手] ${truncate(firstLine, MICRO_SUMMARY_MAX_CHARS)}`;
    }
    case "tool_call":
      return `[工具调用] ${truncate(text, 50)}`;
    case "tool_result":
      return `[工具结果] ${truncate(text, 50)}`;
    case "injected":
      return `[注入] ${truncate(text, 50)}`;
    default:
      return truncate(text, MICRO_SUMMARY_MAX_CHARS);
  }
}

/** 大压缩：保留 system + 工具链完整 + pinned/critical，
 *  其余消息按 task_id 分组生成摘要。 */
function summaryCompress(messages: HarnessMessage[]): {
  messages: HarnessMessage[];
  summary: string;
  taskBlocks: string[];
} {
  const systemMsgs: HarnessMessage[] = [];
  const pinnedOrCritical: HarnessMessage[] = [];
  const compressible: HarnessMessage[] = [];

  // 收集所有 assistant tool_call 的 id，用于保护完整工具链
  const protectedToolCallIds = new Set<string>();
  for (const m of messages) {
    if (m.category === "tool_call" && m.tool_calls) {
      for (const tc of m.tool_calls) if (tc.id) protectedToolCallIds.add(tc.id);
    }
  }
  // 最近 3 组完整工具调用保护（tool_call + tool_result 配对）
  const recentToolChain = collectRecentToolChain(messages, protectedToolCallIds);

  for (const m of messages) {
    if (m.category === "system") {
      systemMsgs.push(m);
    } else if (m.pinned || m.priority === "critical" || m.keep_after_compress) {
      pinnedOrCritical.push(m);
    } else if (recentToolChain.has(m.seq_id)) {
      // 最近工具链：保留原样，不参与摘要
      // （在下方重新排序时加入）
    } else {
      compressible.push(m);
    }
  }

  // 按 task_id 分组生成摘要；没有 task_id 的归到 __no_task__
  const groups = groupByTask(compressible);
  const taskBlocks: string[] = [];
  const summaryLines: string[] = [];
  for (const [taskId, msgs] of groups) {
    const taskSummary = summarizeTask(taskId, msgs);
    summaryLines.push(taskSummary.summary);
    taskBlocks.push(taskId);
  }

  const summary = summaryLines.join("\n\n");

  // 重建消息数组：system + 摘要(user) + pinned/critical + 最近工具链 + 压缩区剩余（按 seq_id）
  const recentToolMsgs = messages.filter((m) => recentToolChain.has(m.seq_id));
  const result: HarnessMessage[] = [
    ...systemMsgs,
    ...pinnedOrCritical,
    ...recentToolMsgs,
  ];
  if (summary.trim()) {
    result.splice(systemMsgs.length, 0, makeSummaryMessage(summary, messages.length));
  }

  return {
    messages: result.sort((a, b) => a.seq_id - b.seq_id),
    summary: buildDroppedSummary(compressible, summary),
    taskBlocks,
  };
}

/** 收集最近 N 组完整工具链的 seq_id，保证 assistant.tool_calls + tool 配对完整 */
function collectRecentToolChain(
  messages: HarnessMessage[],
  protectedIds: Set<string>,
): Set<number> {
  const seqIds = new Set<number>();
  const RECENT_PAIRS = 2; // 保留最近 2 对
  let pairs = 0;
  for (let i = messages.length - 1; i >= 0 && pairs < RECENT_PAIRS; i--) {
    const m = messages[i];
    if (m.category === "tool_result") {
      seqIds.add(m.seq_id);
      // 向上找对应的 assistant tool_call
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev.category !== "tool_call") continue;
        const matched = prev.tool_calls?.some(
          (tc) => tc.id && protectedIds.has(tc.id) && tc.id === m.tool_call_id,
        );
        if (matched) {
          seqIds.add(prev.seq_id);
          pairs++;
          break;
        }
      }
    }
  }
  return seqIds;
}

/** 死区归档：只保留 task_id 列表 + 极简摘要 */
function archiveCompress(input: {
  messages: HarnessMessage[];
  summary: string;
  taskBlocks: string[];
}): { messages: HarnessMessage[]; summary: string; taskBlocks: string[] } {
  const systemMsgs = input.messages.filter((m) => m.category === "system");
  const pinned = input.messages.filter(
    (m) => m.pinned || m.priority === "critical" || m.keep_after_compress,
  );

  const archiveText = `[已归档任务: ${input.taskBlocks.length} 个]\n${input.taskBlocks
    .map((id) => `- ${id}`)
    .join("\n")}`;
  const archiveMsg = makeSummaryMessage(archiveText, input.messages.length);

  return {
    messages: [...systemMsgs, archiveMsg, ...pinned],
    summary: archiveText,
    taskBlocks: input.taskBlocks,
  };
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

function summarizeTask(taskId: string, msgs: HarnessMessage[]): TaskSummary {
  const userInputs: string[] = [];
  const assistantResponses: string[] = [];
  const toolCalls: string[] = [];
  const toolResults: string[] = [];

  for (const m of msgs) {
    const text = m.content.text_content;
    switch (m.category) {
      case "user":
        userInputs.push(truncate(text, 100));
        break;
      case "assistant":
        assistantResponses.push(truncate(text, 150));
        break;
      case "tool_call":
        toolCalls.push(truncate(text, 80));
        break;
      case "tool_result":
        toolResults.push(truncate(text, 80));
        break;
    }
  }

  const parts: string[] = [];
  if (userInputs.length > 0) {
    parts.push(`用户输入(${userInputs.length}): ${userInputs.slice(0, 3).join("; ")}`);
  }
  if (assistantResponses.length > 0) {
    parts.push(
      `助手回复(${assistantResponses.length}): ${assistantResponses.slice(0, 2).join("; ")}`,
    );
  }
  if (toolCalls.length > 0) parts.push(`工具调用(${toolCalls.length})`);
  if (toolResults.length > 0) parts.push(`工具结果(${toolResults.length})`);

  return {
    task_id: taskId,
    start_time: msgs[0]?.created_at ?? new Date().toISOString(),
    summary: truncate(`[${taskId}] ${parts.join(" | ")}`, SUMMARY_MAX_CHARS),
    outline: msgs
      .slice(0, 10)
      .map((m) => `- [${m.category}] ${truncate(m.content.text_content, 50)}`),
  };
}

/** 把被压缩丢弃的消息整理为结构化摘要（v1 兼容字段 droppedSummary） */
function buildDroppedSummary(dropped: HarnessMessage[], taskSummary: string): string {
  if (dropped.length === 0) return "";

  const userSnippets: string[] = [];
  const assistantSnippets: string[] = [];
  let userCount = 0;
  let assistantCount = 0;

  for (const m of dropped) {
    const text = m.content.text_content.trim();
    if (!text) continue;
    if (m.category === "user") {
      userCount++;
      userSnippets.push(
        text.length > SUMMARY_SNIPPET_MAX_CHARS
          ? text.slice(0, SUMMARY_SNIPPET_MAX_CHARS) + "…"
          : text,
      );
    } else if (m.category === "assistant") {
      assistantCount++;
      assistantSnippets.push(
        text.length > SUMMARY_SNIPPET_MAX_CHARS
          ? text.slice(0, SUMMARY_SNIPPET_MAX_CHARS) + "…"
          : text,
      );
    }
  }

  const lines: string[] = [];
  lines.push(
    `[被压缩掉的历史：${userCount} 条 user + ${assistantCount} 条 assistant]`,
  );
  if (taskSummary.trim()) {
    lines.push("\n任务摘要：\n" + taskSummary);
  }
  if (userSnippets.length > 0) {
    lines.push("用户此前说过：");
    for (const s of userSnippets.slice(0, SUMMARY_MAX_ENTRIES_PER_ROLE)) lines.push(`- ${s}`);
    if (userSnippets.length > SUMMARY_MAX_ENTRIES_PER_ROLE) {
      lines.push(`- …（另 ${userSnippets.length - SUMMARY_MAX_ENTRIES_PER_ROLE} 条略）`);
    }
  }
  if (assistantSnippets.length > 0) {
    lines.push("助手此前答复要点：");
    for (const s of assistantSnippets.slice(0, SUMMARY_MAX_ENTRIES_PER_ROLE)) {
      lines.push(`- ${s}`);
    }
    if (assistantSnippets.length > SUMMARY_MAX_ENTRIES_PER_ROLE) {
      lines.push(`- …（另 ${assistantSnippets.length - SUMMARY_MAX_ENTRIES_PER_ROLE} 条略）`);
    }
  }
  return lines.join("\n");
}

function makeSummaryMessage(summary: string, _contextLen: number): HarnessMessage {
  return {
    seq_id: -1, // 摘要消息不参与排序，由 message-builder 放到固定槽位
    task_ids: [],
    content: {
      text_content:
        `<prior_context_summary>\n` +
        `以下是此前对话中被压缩掉的摘要，供参考以保持上下文连贯性：\n\n` +
        `${summary}\n` +
        `</prior_context_summary>`,
    },
    keep_after_compress: true,
    category: "injected",
    original_role: "user",
    priority: "critical",
  };
}

function estimateTokens(messages: HarnessMessage[]): number {
  let totalChars = 0;
  for (const m of messages) {
    totalChars += m.content.text_content.length;
    totalChars += JSON.stringify(m.task_ids).length;
    if (m.tool_calls) totalChars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(totalChars / 3);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

/** 把内部 CompressionResult 扩展为对外 CompressResult */
function buildResult(
  harnessOut: HarnessMessage[],
  originalTokens: number,
  zone: CompressionZone,
  summary = "",
  taskBlocks: string[] = [],
): CompressResult {
  const rawOut = harnessOut.map(harnessToRaw);
  const compressedTokens = estimateTokens(harnessOut);
  return {
    messages: rawOut,
    compressed: zone !== "active_zone",
    droppedSummary: summary,
    zone,
    originalTokens,
    compressedTokens,
    taskBlocks: taskBlocks.length > 0 ? taskBlocks : undefined,
  };
}

// ─── 对外透出的内部工具（仅供测试 / 上层扩展使用） ──────────────────────────

export type { CompressionZone, CompressionResult, TaskSummary };
