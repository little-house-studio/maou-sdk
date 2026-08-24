/**
 * 上下文溢出（context overflow）检测
 *
 * 用一组跨厂商的错误文案模式，识别"输入超过模型上下文窗口"这类错误。
 * 上层（如压缩器）拿到 true 后可触发上下文压缩 / 截断重试，而不是把它当普通 400 丢弃。
 *
 * 注意：部分网关（如讯飞/ModelArts）用业务码 10305 包装**多种** 400，
 * 包括 image_url 不支持等——**不能**见 10305 就当超窗，否则会误压上下文仍失败，
 * 会话表现为「报错瘫痪、只能新开话题」。
 */

/** 明确的上下文溢出文案（小写匹配） */
const OVERFLOW_PATTERNS: RegExp[] = [
  /context[_ ]length[_ ]exceeded/, // OpenAI: context_length_exceeded
  /maximum context length/, // OpenAI: "maximum context length is N tokens"
  /reduce the length of the messages/, // OpenAI 提示
  /string too long/, // OpenAI 超长输入
  /prompt is too long/, // Anthropic: "prompt is too long: N tokens > max"
  /input is too long/, // Anthropic 变体
  /too many tokens/, // 通用
  /token limit/, // 通用
  /exceeds? the (?:maximum|context|token)/, // "exceeds the maximum/context/token ..."
  /input token count.*exceeds/, // Google Gemini
  /the input token count/, // Google
  /request (?:entity )?too large/, // 413 措辞
  /content too large/, // 通用
  /maximum input length/, // 通用
  /context window/, // 通用 "exceeds context window"
  /too long for (?:this )?model/, // 通用
  /tokens?\s*\(\d+\).*(?:exceed|maximum|limit)/, // "tokens (12345) exceed ..."
  /decreasing the (?:input|prompt)/, // Mistral/兼容
  /上下文.{0,8}超/, // 中文：上下文超限/超过
  /超.{0,6}上下文/,
  /输入过长/,
  /prompt.?too.?large/,
  /max.?input.?tokens/,
  /context.?overflow/,
  /超过.*(?:token|上下文|长度)/,
  /(?:token|上下文).*(?:超限|超出|超过)/,
];

/**
 * 明确**不是**上下文溢出的 400（即便带 10305 等网关码）。
 * 这些应走各自恢复路径（例如剥图片），不要强制压缩。
 */
const NON_OVERFLOW_PATTERNS: RegExp[] = [
  /unsupported content type/,
  /only supported type/,
  /image_url/,
  /content type.*text/,
  /invalid character/,
  /modelarts\.81001/i,
  /does not support (?:image|vision|multimodal)/i,
  /vision.*(not supported|unsupported)/i,
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

  // 明确非超窗：优先排除（含网关 10305 包着 image_url 校验失败）
  if (NON_OVERFLOW_PATTERNS.some((re) => re.test(lower))) {
    return false;
  }

  if (OVERFLOW_PATTERNS.some((re) => re.test(lower))) {
    return true;
  }

  // 网关码 10305：仅当正文还带 token/上下文语义时才当超窗
  // （裸 10305 在讯飞侧可表示任意 invalid_request）
  if (/\b10305\b/.test(lower) || /["']?code["']?\s*:\s*10305/.test(lower)) {
    return /token|context|长度|超限|too long|too large|prompt|window|消息过长|输入过/.test(
      lower,
    );
  }

  return false;
}

/**
 * 模型不支持多模态 / image_url 等内容类型。
 * 上层可剥掉 image 块后原样重试，避免误走超窗压缩。
 */
export function detectUnsupportedMediaContent(
  errorText: string | null | undefined,
): boolean {
  if (!errorText) return false;
  const lower = errorText.toLowerCase();
  return (
    /unsupported content type/.test(lower) ||
    (/image_url/.test(lower) && /only supported type|text/.test(lower)) ||
    /does not support (?:image|vision|multimodal)/i.test(errorText) ||
    (/modelarts\.81001/i.test(errorText) && /image_url|content type/.test(lower))
  );
}

/**
 * 从错误文本里尽力抽取 token 数（"12345 tokens" / "(12345)" 等），抽不到返回 null。
 * 便于上层据实际超出量决定压缩比例。
 */
export function extractTokenCount(errorText: string | null | undefined): number | null {
  if (!errorText) return null;
  const m =
    errorText.match(/(\d[\d,]{2,})\s*tokens?/i) ??
    errorText.match(/\((\d[\d,]{3,})\)/);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
