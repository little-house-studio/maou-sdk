/**
 * 工具通用截断与元数据格式化
 *
 * 用于将结构化 payload 中的关键元数据嵌入 message 正文，
 * 防止运行时只取 message 时丢失关键信息（exit_code / 行数 / 命中数等）。
 */

/** 单字段最大字符数（默认 8000，约 2K~4K token） */
export const DEFAULT_CHUNK_LIMIT = 8000;

/**
 * 截断长文本，保留头部 + 尾部，并在中间标注被省略的字符数。
 * 当原始文本 ≤ limit 时原样返回。
 */
export function truncateMiddle(text: string, limit: number = DEFAULT_CHUNK_LIMIT): string {
  if (!text) return text;
  if (text.length <= limit) return text;
  const headSize = Math.floor(limit * 0.6); // 头部占 60%
  const tailSize = Math.max(0, limit - headSize - 80); // 尾部占剩余，留 80 字符给标记
  const skipped = text.length - headSize - tailSize;
  return (
    text.slice(0, headSize) +
    `\n\n... [省略 ${skipped} 字符，共 ${text.length} 字符] ...\n\n` +
    text.slice(text.length - tailSize)
  );
}

/**
 * 拼接 `key=value` 元数据行，仅追加非空字段。
 */
export function formatMetadata(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.length ? `[${parts.join(" | ")}]` : "";
}

/**
 * 安全路径解析，防止路径越界（../../etc/passwd 等）。
 * 统一 read / write-file / edit-file 共用。
 * 实现委托 path-guard（与 PathGuard 多根沙箱同一套 isUnder 逻辑）。
 */
export { safePath } from "../../../path-guard.js";

/**
 * 统一从 catch 的 unknown 值里提取可读错误字符串。
 *
 * 递归提取 Error.cause 链：Node.js 16+ 的 Error 可带 cause 字段表示根本原因，
 * 只取 message 会丢失「为什么失败」的关键信息。例如：
 *   Error: spawn opencli ENOENT → cause: Error: No such file or directory
 * 拼成 "spawn opencli ENOENT [caused by: No such file or directory]" 后更易诊断。
 */
export function errToString(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== null) {
      const causeStr = cause instanceof Error ? cause.message : String(cause);
      if (causeStr && causeStr !== msg) {
        return `${msg} [caused by: ${causeStr}]`;
      }
    }
    return msg;
  }
  // 非 Error 值（字符串、数字、对象）直接转字符串
  if (err === null) return "null";
  if (err === undefined) return "undefined";
  if (typeof err === "object") {
    try { return JSON.stringify(err); } catch { return String(err); }
  }
  return String(err);
}
