/**
 * 紧急截断 —— 超窗恢复最后手段。
 *
 * API 已经报超窗时调用：丢掉中间历史，保留 system 头 + 尾部若干条。
 * 不估算 token。
 */

function msgChars(m: Record<string, unknown>): number {
  const c = m.content;
  if (typeof c === "string") return c.length;
  if (Array.isArray(c)) {
    let n = 0;
    for (const part of c) {
      if (typeof part === "string") n += part.length;
      else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") n += p.text.length;
      }
    }
    return n;
  }
  return 0;
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
  /** 截断后条数，不是 token 估算 */
  estimatedTokens: number;
}

/**
 * 丢掉中间历史，保留 system 头 + 尾部 keepTail 条。
 * @param _maxTokens 忽略（占用不再估算）
 */
export function emergencyTrimMessages(
  messages: Array<Record<string, unknown>>,
  _maxTokens: number,
  opts?: { keepTail?: number },
): EmergencyTrimResult {
  void _maxTokens;
  const keepTail = Math.max(2, opts?.keepTail ?? 8);

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
      estimatedTokens: 0,
    };
  }

  const dropped = rest.length - keepTail;
  const body = rest.slice(-keepTail);
  const notice = {
    role: "user",
    content:
      `<context_emergency_trim dropped="${dropped}">\n` +
      `上下文超限，已紧急丢弃 ${dropped} 条中间历史以继续对话。` +
      `完整记录仍在会话存储中；可 /compact 或新开话题。\n` +
      `</context_emergency_trim>`,
  };
  return {
    messages: [...head, notice, ...body],
    trimmed: true,
    dropped,
    estimatedTokens: 0,
  };
}
