/**
 * 上下文溢出（context overflow）检测
 *
 * 对标 pi-ai：用一组跨厂商的错误文案模式，识别"输入超过模型上下文窗口"这类错误。
 * 上层（如压缩器）拿到 true 后可触发上下文压缩 / 截断重试，而不是把它当普通 400 丢弃。
 *
 * 覆盖 OpenAI / Anthropic / Google / Mistral / DeepSeek / Cohere / 各 OpenAI 兼容厂商
 * 的常见措辞。
 */

/** 上下文溢出错误的常见文案模式（小写匹配） */
const OVERFLOW_PATTERNS: RegExp[] = [
  /context[_ ]length[_ ]exceeded/,           // OpenAI: context_length_exceeded
  /maximum context length/,                   // OpenAI: "maximum context length is N tokens"
  /reduce the length of the messages/,        // OpenAI 提示
  /string too long/,                          // OpenAI 超长输入
  /prompt is too long/,                       // Anthropic: "prompt is too long: N tokens > max"
  /input is too long/,                        // Anthropic 变体
  /too many tokens/,                          // 通用
  /token limit/,                              // 通用
  /exceeds? the (?:maximum|context|token)/,   // "exceeds the maximum/context/token ..."
  /input token count.*exceeds/,               // Google Gemini: "input token count ... exceeds the maximum"
  /the input token count/,                    // Google
  /request (?:entity )?too large/,            // 413 措辞
  /content too large/,                        // 通用
  /maximum input length/,                     // 通用
  /context window/,                           // 通用 "exceeds context window"
  /too long for (?:this )?model/,             // 通用
  /tokens?\s*\(\d+\).*(?:exceed|maximum|limit)/, // "tokens (12345) exceed ..."
  /decreasing the (?:input|prompt)/,          // Mistral/兼容
];

/**
 * 判断一段错误文本/响应体是否为"上下文溢出"。
 * @param errorText 错误信息或厂商响应体
 * @param httpStatus 可选 HTTP 状态码（413 直接判定为溢出）
 */
export function detectContextOverflow(
  errorText: string | null | undefined,
  httpStatus?: number | null,
): boolean {
  if (httpStatus === 413) return true;
  if (!errorText) return false;
  const lower = errorText.toLowerCase();
  return OVERFLOW_PATTERNS.some((re) => re.test(lower));
}

/**
 * 从错误文本里尽力抽取 token 数（"12345 tokens" / "(12345)" 等），抽不到返回 null。
 * 便于上层据实际超出量决定压缩比例。
 */
export function extractTokenCount(errorText: string | null | undefined): number | null {
  if (!errorText) return null;
  const m = errorText.match(/(\d[\d,]{2,})\s*tokens?/i) ?? errorText.match(/\((\d[\d,]{3,})\)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
