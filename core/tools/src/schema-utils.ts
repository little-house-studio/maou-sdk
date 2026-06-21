/**
 * Zod Schema 转 JSON Schema 工具
 *
 * 使用 zod-to-json-schema 库将 Zod schema 转换为 JSON Schema，
 * 供工具参数定义使用。工具开发者可以选择用 Zod 定义参数（获得类型推断和运行时校验），
 * 然后通过此工具函数转换为 JSON Schema 发送给 LLM。
 *
 * 用法:
 * ```typescript
 * import { z } from "zod";
 * import { zodToJsonSchema } from "../schema-utils.js";
 *
 * const paramsSchema = z.object({
 *   path: z.string().describe("文件路径"),
 *   content: z.string().describe("文件内容"),
 * });
 *
 * const jsonSchema = zodToJsonSchema(paramsSchema, "write_file");
 * ```
 */

import { zodToJsonSchema as convert } from "zod-to-json-schema";
import type { z } from "zod";

/**
 * 将 Zod schema 转换为 JSON Schema（用于工具参数定义）
 *
 * @param schema - Zod schema 对象（通常是 z.object({...})）
 * @param name - 可选的工具名称，用于命名 schema
 * @returns 符合 Tool.parameters 格式的 JSON Schema 对象
 */
export function zodToJsonSchema(
  schema: z.ZodTypeAny,
  name?: string,
): Record<string, unknown> {
  const result = name
    ? convert(schema, name)
    : convert(schema);
  return result as Record<string, unknown>;
}

/**
 * 将 Zod schema 转换为工具参数 schema（包含 name/description/parameters）
 *
 * @param name - 工具名称
 * @param description - 工具描述
 * @param schema - Zod schema 对象
 * @returns 符合 Tool.nativeToolSchemas() 格式的 schema 对象
 */
export function zodToToolSchema(
  name: string,
  description: string,
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  return {
    name,
    description,
    ...zodToJsonSchema(schema),
  };
}
