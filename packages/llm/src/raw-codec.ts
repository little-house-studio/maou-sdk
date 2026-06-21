/**
 * 原始 body 编解码器（gzip + base64）
 *
 * 用途：LLM POST 原始记录里，request body 可能很大（几十 KB ~ 几百 KB）。
 * 为了既保留"完全原始的发送内容"（调试/审计需求），又控制磁盘占用，
 * 把 body 压缩成 gzip+base64 字符串存进 JSONL。
 *
 * 设计原则（重要）：
 * - **每条记录独立压缩、独立解码**。decode() 完全无状态——拿到任何一条
 *   `body_compressed` 字符串都能单独还原出原始 body，不依赖会话状态、
 *   不依赖前后条目、不依赖任何缓存。
 *   这样即便同一会话上下文被调试时反复修改（system prompt 变了、
 *   历史被裁剪了等），每条 POST 记录仍能准确还原当时的请求原貌。
 * - **自描述格式**：每条记录带 `algo` 字段，未来换算法（如 zstd/brotli）
 *   可与旧记录共存，decode 能按 algo 分派。
 * - **小 body 不压**：小于阈值（默认 512 字节）时直接存原文，避免 base64
 *   膨胀反而更大。
 *
 * 局限：gzip + base64 不是流式的（一次性编/解码整串），适合"每次 LLM
 * 调用一条记录"的场景，不适合做实时增量压缩。
 */

import { gzipSync, gunzipSync } from "node:zlib";

/** 当前支持的压缩算法标识 */
export const RAW_CODEC_ALGO = "gzip+base64" as const;

/** 小于此阈值（字节数）的 body 不压缩，直接存原文 */
export const RAW_CODEC_MIN_BYTES = 512;

/**
 * 压缩后的载体结构。
 * 存到 JSONL 里时，原始 body 字段会被替换为这个对象。
 */
export interface CompressedBody {
  /** 压缩算法标识，便于未来兼容多算法 */
  algo: typeof RAW_CODEC_ALGO;
  /** gzip 压缩 + base64 编码后的字符串 */
  data: string;
  /** 解压后的原始字节数（用于校验、显示） */
  original_size: number;
  /** 压缩后的字节数（base64 字符串长度） */
  compressed_size: number;
}

/**
 * 把任意文本/对象编码为压缩载体。
 *
 * - 输入字符串：直接压缩。
 * - 输入对象：先 JSON.stringify 再压缩。
 * - 小于 minBytes（默认 512）：返回 null，表示"不值得压缩"——调用方应存原文。
 *
 * @returns 压缩载体，或 null（表示不值得压缩，调用方应直接存原文）
 */
export function encodeRawBody(
  payload: string | Record<string, unknown> | unknown,
  minBytes: number = RAW_CODEC_MIN_BYTES,
): CompressedBody | null {
  let text: string;
  if (typeof payload === "string") {
    text = payload;
  } else {
    try {
      text = JSON.stringify(payload ?? {});
    } catch {
      // 无法序列化的对象：返回 null，调用方应存占位
      return null;
    }
  }

  const originalSize = Buffer.byteLength(text, "utf-8");
  if (originalSize < minBytes) {
    // 太小，不压缩
    return null;
  }

  try {
    const gzipped = gzipSync(Buffer.from(text, "utf-8"));
    const data = gzipped.toString("base64");
    return {
      algo: RAW_CODEC_ALGO,
      data,
      original_size: originalSize,
      compressed_size: data.length,
    };
  } catch {
    // 压缩失败：返回 null，调用方应存原文
    return null;
  }
}

/**
 * 把压缩载体解码回原始文本。
 *
 * 完全无状态：只看 carrier 自身字段，不依赖任何外部状态。
 * 返回 null 表示"无法解码"——调用方可保留压缩载体或显示占位。
 *
 * 支持未来扩展：根据 algo 字段分派不同解压算法。
 */
export function decodeRawBody(carrier: CompressedBody): string | null {
  if (!carrier || typeof carrier !== "object") return null;

  switch (carrier.algo) {
    case RAW_CODEC_ALGO: {
      try {
        const gzipped = Buffer.from(carrier.data, "base64");
        const text = gunzipSync(gzipped).toString("utf-8");
        return text;
      } catch {
        return null;
      }
    }
    default:
      // 未知算法：无法解码
      return null;
  }
}

/**
 * 把压缩载体解码回原始对象（JSON.parse）。
 * 如果原始内容不是合法 JSON（比如压缩前就是纯文本），返回原文。
 */
export function decodeRawBodyAsObject(carrier: CompressedBody): unknown {
  const text = decodeRawBody(carrier);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    // 不是 JSON，返回原文
    return text;
  }
}

/**
 * 透明编解码辅助：给一条记录里的某个字段名做"解码替换"。
 *
 * 例如记录里有 `{body_compressed: {...}}`，调用后变成 `{body: "原始文本"}`。
 * 用于读取端（如 /rawdata API）把压缩字段透明还原为可读字段。
 *
 * @param entry 原始记录对象（会被原地修改）
 * @param compressedFieldName 压缩字段名（如 "body_compressed"）
 * @param targetFieldName 目标字段名（如 "body"）
 * @returns 修改后的 entry（已删除压缩字段，添加了解码后的字段）
 */
export function transparentDecodeField(
  entry: Record<string, unknown>,
  compressedFieldName: string,
  targetFieldName: string,
): Record<string, unknown> {
  const carrier = entry[compressedFieldName];
  if (!carrier || typeof carrier !== "object") return entry;

  const decoded = decodeRawBody(carrier as CompressedBody);
  if (decoded !== null) {
    entry[targetFieldName] = decoded;
  } else {
    // 解码失败：保留压缩载体信息，方便排查
    entry[targetFieldName] = `[undecodable: ${(carrier as CompressedBody).algo}]`;
  }

  // 删除压缩字段，避免前端看到压缩串
  delete entry[compressedFieldName];
  return entry;
}
