/**
 * User-facing model error copy for ChatPanel.
 * Prefer structured `category` from Agent/LLM stream; parse [llm_error] prefix only when category missing.
 */

export function formatModelErrorForUi(
  raw: string,
  category?: string,
  retryable?: boolean,
): string {
  const cat = (category || "").trim();

  // When category already provided, never re-parse prefix (avoids infinite recurse
  // on categories without a special Chinese template).
  if (cat) {
    return formatByCategory(raw, cat, retryable);
  }

  // No category: try structured prefix once, then fall through
  const m = raw.match(/\[llm_error\]\s*category=(\w+)\s+retryable=([01])/);
  if (m) {
    return formatByCategory(raw, m[1]!, m[2] === "1");
  }

  if (retryable === false && /quota|额度|limit/i.test(raw)) {
    return `模型暂时不可用：${raw.slice(0, 280)}\n可在「设置 → LLM」切换预设，或稍后再试。`;
  }
  return raw;
}

function formatByCategory(
  raw: string,
  cat: string,
  retryable?: boolean,
): string {
  if (cat === "quota_exhausted") {
    return `模型暂时不可用（免费额度/配额已用尽）：${raw.slice(0, 280)}\n可在「设置 → LLM」切换预设，或稍后再试。`;
  }
  if (cat === "rate_limit") {
    return `模型限流，请稍后重试：${raw.slice(0, 280)}`;
  }
  if (cat === "auth") {
    return `模型鉴权失败（API Key/权限）：${raw.slice(0, 280)}\n请检查「设置 → LLM」中的密钥与套餐。`;
  }
  if (cat === "context_overflow") {
    return `上下文过长：${raw.slice(0, 280)}\n可再发一条消息触发压缩，或执行 /compact。`;
  }
  if (cat === "network" || cat === "timeout") {
    return `网络/超时：${raw.slice(0, 280)}`;
  }
  if (cat === "server_error") {
    return `模型服务异常：${raw.slice(0, 280)}`;
  }
  if (cat === "content_policy") {
    return `内容被安全策略拦截：${raw.slice(0, 280)}`;
  }
  if (cat === "bad_request") {
    return `模型请求无效：${raw.slice(0, 280)}`;
  }
  // unknown / other: show raw once — do NOT re-enter with same category
  if (retryable === false && /quota|额度/i.test(raw)) {
    return `模型暂时不可用：${raw.slice(0, 280)}\n可在「设置 → LLM」切换预设，或稍后再试。`;
  }
  return raw;
}
