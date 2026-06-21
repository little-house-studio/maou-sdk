/**
 * 适配器公共工具函数
 *
 * 提取各 ProtocolAdapter 实现中重复的逻辑，减少代码冗余。
 */

import { parse as parsePartialJson, Allow } from "partial-json";

/** 模型允许的最大 max_tokens 硬上限 */
export const MAX_TOKENS_CAP = 1_000_000;

/** 将各种类型的值转换为文本（支持 string / string[] / {text} / {content}） */
export function coerceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if (typeof obj.text === "string") {
          parts.push(obj.text);
          continue;
        }
        if (typeof obj.content === "string") {
          parts.push(obj.content);
        }
      }
    }
    return parts.join("");
  }
  return "";
}

/**
 * 解析工具参数字符串为对象
 *
 * 统一的解析策略：
 * 1. 如果已经是对象，直接返回
 * 2. 先尝试标准 JSON.parse（完整 JSON 的快速路径）
 * 3. 失败后用 partial-json 解析不完整 JSON（流式场景）
 * 4. 最终回退到 { _raw_arguments: text }
 */
export function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (value == null) return {};
  const text = String(value).trim();
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    return typeof data === "object" && data !== null && !Array.isArray(data)
      ? data as Record<string, unknown>
      : { value: data };
  } catch {
    try {
      const data = parsePartialJson(text, Allow.ALL);
      return typeof data === "object" && data !== null && !Array.isArray(data)
        ? data as Record<string, unknown>
        : { value: data };
    } catch {
      return { _raw_arguments: text };
    }
  }
}

/** 工具参数 schema 归一化 */
export function normalizeToolParametersSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
}
