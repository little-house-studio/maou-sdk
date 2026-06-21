/**
 * 跨厂商对话交接（Handoff）
 *
 * 对标 pi-ai 的 cross-provider handoff：当对话中途从一个厂商切到另一个厂商时，
 * 把"为上一个厂商准备的历史"归一成"任意厂商都能安全消费的历史"：
 *   - 思考/推理内容 → `<thinking>…</thinking>` 文本（或丢弃）
 *   - 目标不支持原生工具调用时，把 toolCalls 内联为文本
 *   - 目标不支持视觉时，把图片附件降级为文本占位
 *
 * 之所以需要：A 厂商的 thinking block、tool_use 块换到 B 厂商可能非法或丢失语义，
 * 统一转成纯文本可保住上下文连续性。
 */

import type { ChatMessage } from "./chat-session.js";
import type { LLMToolCall, APIPreset } from "./adapters/types.js";
import type { ChatSession } from "./chat-session.js";

/** thinking 处理方式 */
export type ThinkingMode = "tag" | "strip" | "keep";

/** 交接选项 */
export interface HandoffOptions {
  /** 目标模型是否支持原生工具调用（false → 把 toolCalls 内联为文本，默认 true） */
  targetSupportsTools?: boolean;
  /** 目标模型是否支持视觉（false → 图片附件降级为文本占位，默认 true） */
  targetSupportsVision?: boolean;
  /** 历史 content 里已有的 <think>/<thinking> 标签如何处理（默认 "tag" 统一为 <thinking>） */
  thinking?: ThinkingMode;
}

/** 各厂商常见的思考标签（DeepSeek 用 <think>，部分用 <thinking>） */
const THINKING_TAG_RE = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;

/** 抽取并去掉文本中的思考标签内容，返回 { clean, thinking } */
export function splitThinkingTags(text: string): { clean: string; thinking: string } {
  let thinking = "";
  const clean = text.replace(THINKING_TAG_RE, (_m, inner) => {
    thinking += String(inner);
    return "";
  });
  return { clean: clean.trim(), thinking: thinking.trim() };
}

/**
 * 把一段思考内容包裹为统一的 <thinking> 文本。
 */
export function wrapThinking(thinking: string): string {
  const t = thinking.trim();
  return t ? `<thinking>\n${t}\n</thinking>` : "";
}

/**
 * 把"富助手轮次"（正文 + 推理 + 工具调用）合并成一条可跨厂商发送的 assistant 文本消息。
 *
 * @param turn.content          正文
 * @param turn.reasoningContent 推理内容（来自 ModelResponse.reasoningContent）
 * @param turn.toolCalls        原生工具调用
 * @param opts.thinking         推理处理方式（默认 "tag"）
 * @param opts.inlineToolCalls  是否把工具调用内联为文本（默认 true）
 */
export function assistantTurnToText(
  turn: { content?: string; reasoningContent?: string; toolCalls?: LLMToolCall[] },
  opts?: { thinking?: ThinkingMode; inlineToolCalls?: boolean },
): string {
  const thinkingMode = opts?.thinking ?? "tag";
  const inlineTools = opts?.inlineToolCalls ?? true;
  const parts: string[] = [];

  if (turn.reasoningContent && thinkingMode === "tag") {
    parts.push(wrapThinking(turn.reasoningContent));
  }
  if (turn.content) parts.push(turn.content);

  if (inlineTools && turn.toolCalls?.length) {
    for (const call of turn.toolCalls) {
      parts.push(`[调用工具 ${call.name}(${safeJson(call.parameters)})]`);
    }
  }

  return parts.filter(Boolean).join("\n\n");
}

/**
 * 归一一段会话历史，使其可安全发给任意目标厂商。
 */
export function normalizeForHandoff(
  messages: ChatMessage[],
  opts?: HandoffOptions,
): ChatMessage[] {
  const supportsTools = opts?.targetSupportsTools ?? true;
  const supportsVision = opts?.targetSupportsVision ?? true;
  const thinkingMode = opts?.thinking ?? "tag";

  return messages.map((msg) => {
    let content = msg.content ?? "";
    let toolCalls = msg.toolCalls;
    let attachments = msg.attachments;

    // 1. 思考标签处理
    if (thinkingMode !== "keep" && THINKING_TAG_RE.test(content)) {
      THINKING_TAG_RE.lastIndex = 0; // 重置全局正则游标
      const { clean, thinking } = splitThinkingTags(content);
      content = thinkingMode === "tag" && thinking ? `${wrapThinking(thinking)}\n\n${clean}` : clean;
    }

    // 2. 工具调用内联（目标不支持原生工具时）
    if (!supportsTools && toolCalls?.length) {
      const inlined = toolCalls.map((c) => `[调用工具 ${c.name}(${safeJson(c.parameters)})]`).join("\n");
      content = content ? `${content}\n${inlined}` : inlined;
      toolCalls = undefined;
    }

    // 3. 视觉降级（目标不支持视觉时，图片附件转文本占位）
    if (!supportsVision && attachments?.some((a) => a.type === "image")) {
      const kept = attachments.filter((a) => a.type !== "image");
      const imgCount = attachments.length - kept.length;
      if (imgCount > 0) content = `${content}\n[已省略 ${imgCount} 张图片：目标模型不支持视觉]`.trim();
      attachments = kept.length ? kept : undefined;
    }

    return { ...msg, content, toolCalls, attachments };
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 归一化原始消息数组里的 toolCall ID（跨厂商交接关键）。
 *
 * 不同厂商的 tool_call id 格式各异（OpenAI `call_xxx`、Anthropic `toolu_xxx`、
 * Vertex `vertex_call_N`…）。换厂商时这些 id 可能非法或对不上号；本函数把
 * assistant.tool_calls[].id 与对应的 tool.tool_call_id 统一重映射为 `call_1/2/3…`，
 * 保持配对关系不变。原数组不改，返回新数组。
 *
 * @param messages OpenAI 原生 shape 的消息数组（agentLoop / buildMessages 产出的那种）
 */
export function normalizeToolCallIds(
  messages: Record<string, unknown>[],
): Record<string, unknown>[] {
  const idMap = new Map<string, string>();
  let counter = 0;
  const remap = (oldId: string): string => {
    if (!idMap.has(oldId)) {
      counter += 1;
      idMap.set(oldId, `call_${counter}`);
    }
    return idMap.get(oldId)!;
  };

  // 第一遍：按出现顺序，从 assistant.tool_calls 建立映射
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        if (typeof tc.id === "string" && tc.id) remap(tc.id);
      }
    }
  }

  // 第二遍：产出重写后的副本
  return messages.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      return {
        ...msg,
        tool_calls: (msg.tool_calls as Array<Record<string, unknown>>).map((tc) =>
          typeof tc.id === "string" && idMap.has(tc.id) ? { ...tc, id: idMap.get(tc.id) } : tc,
        ),
      };
    }
    if (msg.role === "tool" && typeof msg.tool_call_id === "string") {
      const mapped = idMap.get(msg.tool_call_id);
      return mapped ? { ...msg, tool_call_id: mapped } : msg;
    }
    return msg;
  });
}

/**
 * 把一个 ChatSession 中途切换到新厂商：归一历史 + 替换 preset。
 * 会根据新 preset 的能力位（supportsVision / nativeToolCalling）自动决定降级策略。
 *
 * @example migrateSession(session, claudePreset)  // 从 GPT 切到 Claude，历史自动归一
 */
export function migrateSession(
  session: ChatSession,
  newPreset: APIPreset,
  opts?: HandoffOptions,
): void {
  const merged: HandoffOptions = {
    targetSupportsTools: opts?.targetSupportsTools ?? newPreset.nativeToolCalling !== false,
    targetSupportsVision: opts?.targetSupportsVision ?? newPreset.supportsVision !== false,
    thinking: opts?.thinking ?? "tag",
  };
  session.setHistory(normalizeForHandoff(session.getHistory(), merged));
  session.setPreset(newPreset);
}
