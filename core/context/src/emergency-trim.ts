/**
 * 紧急截断 —— 超窗恢复最后手段。
 *
 * 当 ContextEngine 压缩后整包 prompt（system+tools+history）仍估算出界时，
 * 从「中间历史」往外砍，保留：
 *   - 前部 system 段（连续 system）
 *   - 尾部最近若干条（原文区）
 * 保证还能继续对话，而不是整轮 error 瘫痪。
 */

import { estimateTokensFromText } from "./token-estimate.js";

function msgTokens(m: Record<string, unknown>): number {
  let n = 4;
  const c = m.content;
  if (typeof c === "string") {
    n += estimateTokensFromText(c);
  } else if (Array.isArray(c)) {
    for (const part of c) {
      if (typeof part === "string") n += estimateTokensFromText(part);
      else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") n += estimateTokensFromText(p.text);
        // image 等非文本粗算
        else n += 256;
      }
    }
  } else if (c != null) {
    try {
      n += estimateTokensFromText(JSON.stringify(c));
    } catch {
      n += 32;
    }
  }
  const tcs = m.tool_calls;
  if (Array.isArray(tcs)) {
    for (const tc of tcs) {
      n += 8;
      try {
        n += estimateTokensFromText(JSON.stringify(tc));
      } catch {
        n += 32;
      }
    }
  }
  return n;
}

export function estimateMessagesTokens(
  messages: Array<Record<string, unknown>>,
): number {
  let t = 0;
  for (const m of messages) t += msgTokens(m);
  return t;
}

/**
 * 把多模态 content 数组压成纯文本（去掉 image_url 等）。
 * 用于「模型不支持图片」时的就地修复重试。
 */
export function stripNonTextContent(
  messages: Array<Record<string, unknown>>,
): { messages: Array<Record<string, unknown>>; stripped: number } {
  let stripped = 0;
  const out = messages.map((m) => {
    const c = m.content;
    if (!Array.isArray(c)) return m;
    const texts: string[] = [];
    let removed = 0;
    for (const part of c) {
      if (typeof part === "string") {
        texts.push(part);
        continue;
      }
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        const typ = String(p.type ?? "");
        if (typ === "text" || typeof p.text === "string") {
          texts.push(String(p.text ?? ""));
        } else {
          removed++;
          stripped++;
        }
      }
    }
    if (removed === 0) return m;
    return {
      ...m,
      content:
        texts.filter(Boolean).join("\n") ||
        "[非文本内容已移除：当前模型不支持 image/多模态]",
    };
  });
  return { messages: out, stripped };
}

export interface EmergencyTrimResult {
  messages: Array<Record<string, unknown>>;
  trimmed: boolean;
  dropped: number;
  estimatedTokens: number;
}

/**
 * 紧急截断到 maxTokens 估算以内。
 * @param keepTail 至少保留尾部条数（默认 8）
 */
export function emergencyTrimMessages(
  messages: Array<Record<string, unknown>>,
  maxTokens: number,
  opts?: { keepTail?: number },
): EmergencyTrimResult {
  const keepTail = Math.max(2, opts?.keepTail ?? 8);
  const budget = Math.max(512, maxTokens);
  const total = estimateMessagesTokens(messages);
  if (total <= budget || messages.length <= keepTail + 1) {
    return {
      messages,
      trimmed: false,
      dropped: 0,
      estimatedTokens: total,
    };
  }

  // 前缀：连续 system
  let headEnd = 0;
  while (headEnd < messages.length && messages[headEnd]?.role === "system") {
    headEnd++;
  }
  const head = messages.slice(0, headEnd);
  const rest = messages.slice(headEnd);
  if (rest.length <= keepTail) {
    return {
      messages,
      trimmed: false,
      dropped: 0,
      estimatedTokens: total,
    };
  }

  // 从 rest 头（最旧）开始丢，直到 head+tail 估 token ≤ budget
  let dropCount = 0;
  let body = rest;
  while (body.length > keepTail) {
    const candidate = [...head, ...body.slice(-keepTail)];
    // 若 head+全 body 已够矮则停（首次）
    const withAll = [...head, ...body];
    if (estimateMessagesTokens(withAll) <= budget) break;

    const tail = body.slice(-keepTail);
    const mid = body.slice(0, body.length - keepTail);
    if (mid.length === 0) break;
    // 丢掉 mid 最旧一条
    body = [...mid.slice(1), ...tail];
    dropCount++;
    if (estimateMessagesTokens([...head, ...body]) <= budget) break;
  }

  // 仍超：再砍 tail 到最少 2 条，并截断超长 content
  let finalMsgs = [...head, ...body];
  while (
    estimateMessagesTokens(finalMsgs) > budget &&
    body.length > 2
  ) {
    body = body.slice(1);
    dropCount++;
    finalMsgs = [...head, ...body];
  }

  // 仍超：截断单条超长文本
  if (estimateMessagesTokens(finalMsgs) > budget) {
    finalMsgs = finalMsgs.map((m) => {
      if (typeof m.content !== "string" || m.content.length < 2000) return m;
      const keep = Math.min(1500, Math.floor(m.content.length * 0.3));
      return {
        ...m,
        content:
          m.content.slice(0, keep) +
          "\n…[emergency trim]…\n" +
          m.content.slice(-Math.min(400, keep)),
      };
    });
  }

  // 中间插入一条说明
  if (dropCount > 0) {
    const notice = {
      role: "user",
      content:
        `<context_emergency_trim dropped="${dropCount}">\n` +
        `上下文超限，已紧急丢弃 ${dropCount} 条中间历史以继续对话。` +
        `完整记录仍在会话存储中；可 /compact 或新开话题。\n` +
        `</context_emergency_trim>`,
    };
    // 插在 head 后、body 前
    finalMsgs = [...head, notice, ...body];
  }

  return {
    messages: finalMsgs,
    trimmed: dropCount > 0 || estimateMessagesTokens(finalMsgs) < total,
    dropped: dropCount,
    estimatedTokens: estimateMessagesTokens(finalMsgs),
  };
}
