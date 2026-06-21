/**
 * Token 计数 —— 轻量估算（无需 tiktoken 依赖）
 *
 * 用途：发送前估算 token、UI 显示"X/上下文窗口"、压缩阈值决策。
 * 精度：启发式（中英混合约 1 token ≈ 2.5 字符英文 / 1 字符中文），误差 ±10%。
 * 如需精确，可注入 countTokens: (text, model) => number 覆盖。
 */

/** 启发式 token 估算 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const ascii = text.length - cjk;
  // 中文约 1 字/token，英文约 4 字符/token
  return Math.ceil(cjk * 1.0 + ascii / 4);
}

/** 估算一个 Context 的总输入 token（system + messages + tools schema） */
export function estimateContextTokens(ctx: {
  systemPrompt?: string;
  messages: Array<{ content?: unknown }>;
  tools?: Array<{ parameters?: unknown; name?: string; description?: string }>;
}): number {
  let total = 0;
  if (ctx.systemPrompt) total += estimateTokens(ctx.systemPrompt);
  for (const m of ctx.messages) {
    const c = m.content;
    if (typeof c === "string") total += estimateTokens(c);
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part === "object") {
          const t = (part as Record<string, unknown>).text;
          if (typeof t === "string") total += estimateTokens(t);
          // 图片：粗估 1000 token/张（vision token 因模型而异）
          if ((part as Record<string, unknown>).type === "image") total += 1000;
        }
      }
    }
  }
  // 工具 schema：粗略按 JSON 长度
  for (const tool of ctx.tools ?? []) {
    try {
      total += estimateTokens(JSON.stringify(tool));
    } catch {
      total += 50;
    }
  }
  return total;
}

/**
 * 判断 Context 是否会超模型上下文窗口，建议动作。
 * @returns ok / needCompress / overflow
 */
export function checkContextFit(
  ctxTokens: number,
  contextWindow: number,
  reserveOutput = 4096,
): { status: "ok" | "needCompress" | "overflow"; remaining: number; ratio: number } {
  const usable = contextWindow - reserveOutput;
  const ratio = ctxTokens / usable;
  if (ratio > 1) return { status: "overflow", remaining: usable - ctxTokens, ratio };
  if (ratio > 0.7) return { status: "needCompress", remaining: usable - ctxTokens, ratio };
  return { status: "ok", remaining: usable - ctxTokens, ratio };
}
