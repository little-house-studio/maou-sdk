/**
 * 消息构建器 —— 从 session 历史构建发送给 LLM 的消息数组。
 *
 * 消息顺序：
 *   system(SYSTEM.md)
 *   → system(项目上下文: .maou/project/ USER/PROJECT/RULE/DESIGN/EXPERIENCE)
 *   → system(平台上下文)
 *   → system(滚动摘要，若存在)
 *   → 历史(user/assistant/tool)
 *   → 仅首轮：上下文动态区（BEFORE_USER / 动态注入）/ 实际用户消息
 */

import type { BuildMessagesParams, UserMessageOptions } from "./types.js";
import type { LLMToolCall } from "./types/message.js";
import { noteContextStructure } from "./context-assert.js";
import { compileProjectContext } from "./project-context.js";
import { compileWorkspaceInstructions } from "./workspace-instructions.js";
import { contentWithThinkingForLlm } from "./thinking-context.js";

/**
 * 从 session 历史构建发送给 LLM 的消息数组。
 */
export function buildMessages(params: BuildMessagesParams): Record<string, unknown>[] {
  const {
    systemPrompt,
    sessionMessages,
    roundCount,
    userOpts,
    platformContext,
    rollingSummary,
    structuredMemory,
    projectRoot,
    compressedHistory,
    workspaceInstructions,
    replaceWorkspaceBaseline,
  } = params;

  const messages: Record<string, unknown>[] = [];

  // ── 上下文层槽位顺序（见 core/context/context需求.md §上下文层结构） ──
  // system_pre → System.md(systemPrompt) → system_post → 文件缓存区 →
  // compressed_summary → 历史消息 → 上下文动态区(before_user / dynamic_injections) → user_message

  const userOptsSafe = userOpts ?? {};

  // 1. system_pre（可注入 system 前区）
  if (userOptsSafe.systemPre && userOptsSafe.systemPre.trim()) {
    messages.push({ role: "system", content: userOptsSafe.systemPre.trim() });
  }

  // 2. System.md（主系统提示词）
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  // 3. system_post（可注入 system 后区）
  if (userOptsSafe.systemPost && userOptsSafe.systemPost.trim()) {
    messages.push({ role: "system", content: userOptsSafe.systemPost.trim() });
  }

  // 4. 文件缓存区（稳定前缀：用户偏好、项目说明、钉死的文件；缓存断点之前）
  const fileCacheZone = (userOptsSafe.fileCacheZone ?? userOptsSafe.bakedContext)?.trim();
  if (fileCacheZone) {
    messages.push({ role: "user", content: fileCacheZone });
  }

  // 5. 项目上下文注入（.maou/project/*.md）—— 同属文件缓存区，独立 system 块
  if (projectRoot) {
    const projectContext = compileProjectContext(projectRoot);
    if (projectContext) {
      messages.push({ role: "system", content: projectContext });
    }
    const instructions = compileWorkspaceInstructions(projectRoot, {
      replaceBaseline: replaceWorkspaceBaseline,
      enabled: workspaceInstructions !== false,
    });
    if (instructions) {
      messages.push({ role: "system", content: instructions });
    }
  }

  // 6. 平台上下文注入（由插件提供，仅在该平台会话中生效）
  if (platformContext) {
    messages.push({ role: "system", content: platformContext });
  }

  // 7. 结构化记忆（从 MemoryStore recall，跨会话持久化）
  if (structuredMemory && structuredMemory.trim()) {
    messages.push({
      role: "system",
      content: structuredMemory.trim(),
    });
  }

  // 8. compressed_summary（来自压缩器的摘要；优先于旧的 rollingSummary）
  const compressedSummary =
    userOptsSafe.compressedSummary?.trim() || rollingSummary?.trim() || "";
  if (compressedSummary) {
    messages.push({
      role: "system",
      content:
        `<prior_context_summary>\n` +
        `以下是此前对话中被压缩掉的摘要，供参考以保持上下文连贯性：\n\n` +
        `${compressedSummary}\n` +
        `</prior_context_summary>`,
    });
  }

  // 稳定前缀到此为止：往后是随轮次生长的历史与用户消息
  const prefixCount = messages.length;

  // ── 历史消息 ──
  // 传入 compressedHistory（来自 ContextEngine.toLLMHistory）时用它做历史段，
  // 否则走原始 sessionMessages 路径（保留多模态图片旁路）。
  if (compressedHistory && compressedHistory.length > 0) {
    for (const msg of compressedHistory) {
      const entry: Record<string, unknown> = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        entry.tool_calls = msg.tool_calls.map(tc => ({
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
      // DeepSeek / OpenCode thinking：assistant + tool_calls 必须带 reasoning_content 字段
      // （缺字段 → 400；空字符串可过；旧会话无真思考时用 "" 兜底）
      if (msg.role === "assistant") {
        const rcRaw = (msg as { reasoning_content?: unknown }).reasoning_content;
        const rc = typeof rcRaw === "string" ? rcRaw.trim() : "";
        const hasTc =
          Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0;
        if (rc) entry.reasoning_content = rc;
        else if (hasTc) entry.reasoning_content = "";
      }
      messages.push(entry);
    }
  } else {
    for (const msg of sessionMessages) {
      if ((msg as { visibility?: string }).visibility === "ui") continue;
      // 后台终端完成通知：session 存 role=tool，但 call id 是合成的、历史上无对应 assistant.tool_calls。
      // 发给 LLM 前插入合成 assistant tool_call，保证 tool 角色合法，且语义仍是工具结果（非 user）。
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
          // thinking 模式：合成 tool_call 也必须带 reasoning_content 字段
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

      // assistant 历史：
      // - content：可带 <thinking> 标签（压缩/通用兼容）
      // - reasoning_content：DeepSeek V4 thinking 模式硬要求回传独立字段
      const reasoningRaw =
        msg.role === "assistant" && typeof msg.reasoningContent === "string"
          ? msg.reasoningContent.trim()
          : "";
      const historyContent =
        msg.role === "assistant"
          ? contentWithThinkingForLlm(
              String(msg.content ?? ""),
              reasoningRaw || undefined,
            )
          : msg.content;
      const entry: Record<string, unknown> = {
        role: msg.role,
        content: historyContent,
      };
      const nativeToolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined;
      if (nativeToolCalls && nativeToolCalls.length > 0) {
        entry.tool_calls = nativeToolCalls.map(tc => ({
          id: tc.id,
          type: tc.type || "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments ?? tc.parameters ?? {}),
          },
        }));
      }
      // thinking 模式：有 tool_calls 时字段必带（空串可过；有真值优先）
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

      // 工具结果含图片：追加一条 user 消息携带多模态图片（OpenAI tool role 不支持多模态）
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
  }

  // ── Orphaned tool call 保护 ──
  repairOrphanedToolCalls(messages);

  // ── thinking 模式安全网：任何 assistant+tool_calls 必须带 reasoning_content ──
  // （终端通知合成、旧会话、repair 补丁都可能漏字段）
  for (const entry of messages) {
    if (entry.role !== "assistant") continue;
    const tcs = entry.tool_calls;
    if (!Array.isArray(tcs) || tcs.length === 0) continue;
    if (typeof entry.reasoning_content !== "string") {
      entry.reasoning_content = "";
    }
  }

  // ── 动态上下文注入 ──
  injectUserContext(messages, roundCount, userOpts);

  noteContextStructure(messages, prefixCount);
  return messages;
}

/**
 * 扫描所有 assistant 消息的 tool_calls，为没有对应 tool response 的补入合成响应。
 * 避免 API 因 orphaned tool call 报错。
 */
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

  // 找出没有响应的 tool_call，在对应 assistant 消息后面插入合成响应
  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = messages[i]!;
    if (entry.role !== "assistant" || !Array.isArray(entry.tool_calls)) continue;
    const orphans = (entry.tool_calls as Array<{ id: string; function?: { name?: string } }>)
      .filter(tc => tc.id && allCallIds.has(tc.id) && !respondedIds.has(tc.id));
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

  // 从高索引到低索引插入，避免索引偏移
  for (const o of orphanEntries) {
    messages.splice(o.afterIndex + 1, 0, o.entry);
  }
}

/**
 * 注入用户上下文：上下文动态区（BEFORE_USER / 动态注入）/ 实际用户消息。
 * 动态区始终合并为单条 user 消息——不连续发送多条 user。
 */
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
    ].filter(Boolean).join("\n\n");

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
      const content = [injectedText, userOpts.userMessage?.trim() || ""]
        .filter(Boolean).join("\n\n");
      messages.push({ role: "user", content });
    }
  } else if (roundCount > 0 && userOpts?.dynamicInjections?.trim()) {
    // 子轮（roundCount>0）的动态状态改为 system 注入：否则作为 user 消息时，
    // 模型会把状态当成新的用户发言并复述（"收到状态信息...等待指令"），浪费 round 并跑偏。
    messages.push({ role: "system", content: userOpts.dynamicInjections.trim() });
  }
}