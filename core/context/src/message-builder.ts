/**
 * 消息构建器 —— 从 session 历史构建发送给 LLM 的消息数组。
 *
 * 消息顺序：
 *   system(SYSTEM.md)
 *   → system(项目上下文: USER.md/PROJECT.md/RULE.md)
 *   → system(平台上下文)
 *   → system(滚动摘要，若存在)
 *   → 历史(user/assistant/tool)
 *   → 仅首轮：BEFORE_USER / 动态注入 / 实际用户消息
 */

import type { BuildMessagesParams, UserMessageOptions } from "./types.js";
import { compileProjectContext } from "./project-context.js";

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
  } = params;

  const messages: Record<string, unknown>[] = [];

  // ── 上下文层槽位顺序（见 core/context/context需求.md §上下文层结构） ──
  // system_pre → System.md(systemPrompt) → system_post → baked_context →
  // compressed_summary → 历史消息 → before_user → dynamic_injections → user_message

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

  // 4. baked_context（烘焙上下文区：用户偏好、项目信息等不变区域 + 增量注入）
  if (userOptsSafe.bakedContext && userOptsSafe.bakedContext.trim()) {
    messages.push({ role: "user", content: userOptsSafe.bakedContext.trim() });
  }

  // 5. 项目上下文注入（USER.md/PROJECT.md/RULE.md）—— 烘焙区的动态部分
  if (projectRoot) {
    const projectContext = compileProjectContext(projectRoot);
    if (projectContext) {
      messages.push({ role: "system", content: projectContext });
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

  // ── 历史消息 ──
  for (const msg of sessionMessages) {
    const entry: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
    const nativeToolCalls = msg.native_tool_calls as Array<Record<string, unknown>> | undefined;
    if (nativeToolCalls && nativeToolCalls.length > 0) {
      entry.tool_calls = nativeToolCalls.map(tc => ({
        id: tc.id,
        type: tc.type || "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.parameters ?? {}),
        },
      }));
    }
    if (msg.tool_call_id) {
      entry.tool_call_id = msg.tool_call_id;
    }
    messages.push(entry);

    // 工具结果含图片：追加一条 user 消息携带多模态图片（OpenAI tool role 不支持多模态）
    const msgImages = msg.images as Array<{ mimeType: string; data: string }> | undefined;
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

  // ── Orphaned tool call 保护 ──
  repairOrphanedToolCalls(messages);

  // ── 动态上下文注入 ──
  injectUserContext(messages, roundCount, userOpts);

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
 * 注入用户上下文：BEFORE_USER / 动态注入 / 实际用户消息。
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
    messages.push({ role: "user", content: userOpts.dynamicInjections.trim() });
  }
}