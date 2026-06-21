/**
 * 工具系统基础类型与抽象类
 * 对应 Python: core/tools/base.py
 */

import type { z } from "zod";
// 工具基础类型权威源在 @little-house-studio/types（最底层），此处 import + 重导出
import type { JsonSchema, ToolDefinition, ToolContext, ToolResponse, ToolCall, ToolResult } from "@little-house-studio/types";
export type { JsonSchema, ToolDefinition, ToolContext, ToolResponse, ToolCall, ToolResult };

/**
 * 创建默认的工具执行结果
 */
export function createToolResponse(
  ok: boolean,
  message: string,
  extras?: Partial<ToolResponse>,
): ToolResponse {
  return {
    ok,
    message,
    displayEvents: [],
    payload: {},
    background: false,
    images: [],
    ...extras,
  };
}

/**
 * 工具抽象基类
 * 所有工具实现必须继承此类并实现 definition 和 execute 方法
 *
 * 工具参数定义方式（二选一）：
 * 1. 在 definition.parameters 中直接定义 JSON Schema（传统方式）
 * 2. 设置 zodParameters 字段，使用 Zod 定义参数（推荐，获得类型推断和运行时校验）
 *    当 zodParameters 存在时，nativeToolSchemas() 会自动将其转换为 JSON Schema
 */
export abstract class Tool {
  abstract readonly definition: ToolDefinition;

  /**
   * 可选：用 Zod 定义工具参数
   * 设置后，nativeToolSchemas() 会优先使用 zodParameters 转换的 JSON Schema
   */
  readonly zodParameters?: z.ZodTypeAny;

  /**
   * 获取工具的原生 schema（用于发送给 LLM）
   * 优先使用 zodParameters（如果定义了），否则使用 definition.parameters
   */
  nativeToolSchemas(): JsonSchema[] {
    const { name, description, parameters } = this.definition;
    if (!name) return [];

    // 如果定义了 zodParameters，使用 zod-to-json-schema 转换
    if (this.zodParameters) {
      try {
        // 延迟导入避免循环依赖
        const { zodToJsonSchema } = require("./schema-utils.js") as typeof import("./schema-utils.js");
        const jsonSchema = zodToJsonSchema(this.zodParameters, name);
        return [
          {
            name,
            description: description || name,
            type: "object",
            ...jsonSchema,
          },
        ];
      } catch {
        // 转换失败，回退到 definition.parameters
      }
    }

    return [
      {
        name,
        description: description || name,
        ...parameters,
      },
    ];
  }

  /**
   * 执行工具
   */
  abstract execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse>;

  /**
   * 会话清理钩子（可选）
   * 当 session 开始时调用，用于清理 session-scoped 数据
   */
  onSessionStart?(_sessionId: string): void;
}
