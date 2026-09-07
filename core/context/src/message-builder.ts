/**
 * 传统方案的消息拼装：用组件层槽位搭好默认顺序。
 * 要魔改：createTraditionalAssembly().insert / replace / remove。
 */

import {
  createAssembly,
  defineHook,
  defineSlot,
  type Assembly,
  type AssemblyMessage,
} from "@little-house-studio/context-components";
import type { BuildMessagesParams, UserMessageOptions } from "./types.js";
import type { LLMToolCall } from "./types/message.js";
import { noteContextStructure } from "./context-assert.js";
import { compileProjectContext } from "./project-context.js";
import { compileWorkspaceInstructions } from "./workspace-instructions.js";
import { contentWithThinkingForLlm } from "./thinking-context.js";

export const TRADITIONAL_SLOT = {
  systemPre: "system_pre",
  system: "system",
  systemPost: "system_post",
  fileCache: "file_cache",
  project: "project",
  workspaceInstructions: "workspace_instructions",
  platform: "platform",
  memory: "memory",
  compressedSummary: "compressed_summary",
  history: "history",
} as const;

export function createTraditionalAssembly(): Assembly<BuildMessagesParams> {
  return createAssembly<BuildMessagesParams>({
    slots: [
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.systemPre,
        order: 10,
        provide: (p) => p.userOpts?.systemPre?.trim() || null,
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.system,
        order: 20,
        provide: (p) => p.systemPrompt || null,
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.systemPost,
        order: 30,
        provide: (p) => p.userOpts?.systemPost?.trim() || null,
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.fileCache,
        order: 40,
        role: "user",
        provide: (p) => (p.userOpts?.fileCacheZone ?? p.userOpts?.bakedContext)?.trim() || null,
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.project,
        order: 50,
        provide: (p) => (p.projectRoot ? compileProjectContext(p.projectRoot) : null),
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.workspaceInstructions,
        order: 60,
        provide: (p) => {
          if (!p.projectRoot) return null;
          return compileWorkspaceInstructions(p.projectRoot, {
            replaceBaseline: p.replaceWorkspaceBaseline,
            enabled: p.workspaceInstructions !== false,
          });
        },
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.platform,
        order: 70,
        provide: (p) => p.platformContext?.trim() || null,
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.memory,
        order: 80,
        provide: (p) => p.structuredMemory?.trim() || null,
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.compressedSummary,
        order: 90,
        provide: (p) => {
          const summary =
            p.userOpts?.compressedSummary?.trim() || p.rollingSummary?.trim() || "";
          if (!summary) return null;
          return (
            `<prior_context_summary>\n` +
            `以下是此前对话中被压缩掉的摘要，供参考以保持上下文连贯性：\n\n` +
            `${summary}\n` +
            `</prior_context_summary>`
          );
        },
      }),
      defineSlot<BuildMessagesParams>({
        name: TRADITIONAL_SLOT.history,
        order: 100,
        prefix: false,
        provide: provideHistory,
      }),
    ],
    after: [
      defineHook<BuildMessagesParams>({
        name: "repair_orphans",
        apply: (messages) => {
          repairOrphanedToolCalls(messages);
        },
      }),
      defineHook<BuildMessagesParams>({
        name: "thinking_safety",
        apply: (messages) => {
          for (const entry of messages) {
            if (entry.role !== "assistant") continue;
            const tcs = entry.tool_calls;
            if (!Array.isArray(tcs) || tcs.length === 0) continue;
            if (typeof entry.reasoning_content !== "string") {
              entry.reasoning_content = "";
            }
          }
        },
      }),
      defineHook<BuildMessagesParams>({
        name: "inject_user",
        apply: (messages, ctx) => {
          injectUserContext(messages, ctx.roundCount, ctx.userOpts);
        },
      }),
      defineHook<BuildMessagesParams>({
        name: "note_structure",
        apply: (messages, _ctx, meta) => {
          noteContextStructure(messages, meta.prefixCount);
        },
      }),
    ],
  });
}

export function buildMessages(params: BuildMessagesParams): Record<string, unknown>[] {
  return createTraditionalAssembly().assemble(params);
}

function provideHistory(params: BuildMessagesParams): AssemblyMessage[] {
  const { sessionMessages, compressedHistory } = params;
  const messages: AssemblyMessage[] = [];

  if (compressedHistory && compressedHistory.length > 0) {
    for (const msg of compressedHistory) {
      const entry: AssemblyMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        entry.tool_calls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify((tc as LLMToolCall).arguments ?? {}),
          },
        }));
      }
      if (msg.tool_call_id) {
        entry.tool_call_id = msg.tool_call_id;
      }
      if (msg.role === "assistant") {
        const rcRaw = (msg as { reasoning_content?: unknown }).reasoning_content;
        const rc = typeof rcRaw === "string" ? rcRaw.trim() : "";
        const hasTc = Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0;
        if (rc) entry.reasoning_content = rc;
        else if (hasTc) entry.reasoning_content = "";
      }
      messages.push(entry);
    }
    return messages;
  }

  for (const msg of sessionMessages) {
    if ((msg as { visibility?: string }).visibility === "ui") continue;
    const isTermNotify =
      msg.role === "tool" &&
      (msg.source === "terminal-notification" ||
        (typeof msg.toolCallId === "string" && msg.toolCallId.startsWith("term_notify_")) ||
        (typeof msg.tool_call_id === "string" && String(msg.tool_call_id).startsWith("term_notify_")));

    if (isTermNotify) {
      const callId = String(msg.toolCallId ?? msg.tool_call_id ?? `term_notify_${messages.length}`);
      const params =
        (msg.tool_parameters as Record<string, unknown> | undefined) ??
        { event: "background_complete", terminal_id: msg.terminal_id };
      messages.push({
        role: "assistant",
        content: "",
        reasoning_content: "",
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: {
              name: String(msg.tool_name ?? "use_terminal"),
              arguments: JSON.stringify(params),
            },
          },
        ],
      });
      messages.push({
        role: "tool",
        tool_call_id: callId,
        content: msg.content,
      });
      continue;
    }

    const reasoningRaw =
      msg.role === "assistant" && typeof msg.reasoningContent === "string"
        ? msg.reasoningContent.trim()
        : "";
    const historyContent =
      msg.role === "assistant"
        ? contentWithThinkingForLlm(String(msg.content ?? ""), reasoningRaw || undefined)
        : msg.content;
    const entry: AssemblyMessage = {
      role: msg.role,
      content: historyContent,
    };
    const nativeToolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined;
    if (nativeToolCalls && nativeToolCalls.length > 0) {
      entry.tool_calls = nativeToolCalls.map((tc) => ({
        id: tc.id,
        type: tc.type || "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments ?? tc.parameters ?? {}),
        },
      }));
    }
    if (msg.role === "assistant") {
      if (reasoningRaw) entry.reasoning_content = reasoningRaw;
      else if (nativeToolCalls && nativeToolCalls.length > 0) {
        entry.reasoning_content = "";
      }
    }
    if (msg.toolCallId) {
      entry.tool_call_id = msg.toolCallId;
    } else if (msg.tool_call_id) {
      entry.tool_call_id = msg.tool_call_id;
    }
    const msgImages = msg.images as Array<{ mimeType: string; data: string }> | undefined;
    if (msg.role === "user" && msgImages && msgImages.length > 0) {
      const parts: Array<Record<string, unknown>> = [];
      if (typeof historyContent === "string" && historyContent.trim()) {
        parts.push({ type: "text", text: historyContent });
      }
      for (const img of msgImages) {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        });
      }
      entry.content = parts;
    }
    messages.push(entry);

    if (msg.role === "tool" && msgImages && msgImages.length > 0) {
      const imageContentParts: Array<Record<string, unknown>> = [
        { type: "text", text: `[以下是工具 ${msg.tool_name ?? "read"} 返回的图片]` },
      ];
      for (const img of msgImages) {
        imageContentParts.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.data}` },
        });
      }
      messages.push({ role: "user", content: imageContentParts });
    }
  }
  return messages;
}

function repairOrphanedToolCalls(messages: Record<string, unknown>[]): void {
  const allCallIds = new Set<string>();
  const respondedIds = new Set<string>();
  const orphanEntries: Array<{ afterIndex: number; entry: Record<string, unknown> }> = [];

  for (const entry of messages) {
    if (entry.role === "assistant" && Array.isArray(entry.tool_calls)) {
      for (const tc of entry.tool_calls as Array<{ id: string }>) {
        if (tc.id) allCallIds.add(tc.id);
      }
    }
    if (entry.role === "tool" && typeof entry.tool_call_id === "string") {
      respondedIds.add(entry.tool_call_id);
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = messages[i]!;
    if (entry.role !== "assistant" || !Array.isArray(entry.tool_calls)) continue;
    const orphans = (entry.tool_calls as Array<{ id: string; function?: { name?: string } }>)
      .filter((tc) => tc.id && allCallIds.has(tc.id) && !respondedIds.has(tc.id));
    for (const orphan of orphans.reverse()) {
      orphanEntries.push({
        afterIndex: i,
        entry: {
          role: "tool",
          tool_call_id: orphan.id,
          content: `[系统自动补充] 工具 ${orphan.function?.name ?? "unknown"} 的执行结果因服务中断或异常未能返回。`,
        },
      });
    }
  }

  for (const o of orphanEntries) {
    messages.splice(o.afterIndex + 1, 0, o.entry);
  }
}

function injectUserContext(
  messages: Record<string, unknown>[],
  roundCount: number,
  userOpts?: UserMessageOptions,
): void {
  if (roundCount === 0 && userOpts?.userMessage) {
    const lastMsg = messages[messages.length - 1];
    const isLastUser = lastMsg && lastMsg.role === "user";
    if (isLastUser) messages.pop();

    const injectedText = [
      userOpts.beforeUserContent?.trim() || "",
      userOpts.dynamicInjections?.trim() || "",
    ]
      .filter(Boolean)
      .join("\n\n");

    if (isLastUser) {
      const c = (lastMsg as Record<string, unknown>).content;
      if (typeof c === "string") {
        const content = injectedText ? `${injectedText}\n\n${c}` : c;
        messages.push({ role: "user", content });
      } else if (Array.isArray(c)) {
        const arr: Array<Record<string, unknown>> = [];
        if (injectedText) arr.push({ type: "text", text: injectedText });
        arr.push(...(c as Array<Record<string, unknown>>));
        messages.push({ role: "user", content: arr });
      } else {
        messages.push(lastMsg as Record<string, unknown>);
      }
    } else if (injectedText || userOpts.userMessage?.trim()) {
      const content = [injectedText, userOpts.userMessage?.trim() || ""].filter(Boolean).join("\n\n");
      messages.push({ role: "user", content });
    }
  } else if (roundCount > 0 && userOpts?.dynamicInjections?.trim()) {
    messages.push({ role: "system", content: userOpts.dynamicInjections.trim() });
  }
}
