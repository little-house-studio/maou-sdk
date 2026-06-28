/**
 * 工具系统基础类型与抽象类
 * 对应 Python: core/tools/base.py
 */

import type { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// 工具基础类型权威源在 @little-house-studio/types（最底层），此处 import + 重导出
import type { JsonSchema, ToolDefinition, ToolContext, ToolResponse, ToolCall, ToolResult } from "@little-house-studio/types";
export type { JsonSchema, ToolDefinition, ToolContext, ToolResponse, ToolCall, ToolResult };

/**
 * 从 import.meta.url 推算工具目录路径。
 * 子类中使用: schemaDir = toolDir(import.meta.url)
 *
 * 当从 dist/ 加载编译后的 .js 时，import.meta.url 指向 dist/ 目录，
 * 但 schema.json 和 TOOL.md 仍在 src/ 目录下。
 * 此函数检测 dist/ 路径并回退到对应的 src/ 路径。
 */
export function toolDir(metaUrl: string): string {
  const raw = dirname(fileURLToPath(metaUrl));
  // dist/ → src/ 回退：schema.json 和 TOOL.md 只存在于 src/
  if (raw.includes("/dist/")) {
    const srcPath = raw.replace(/\/dist\//, "/src/");
    if (existsSync(srcPath)) return srcPath;
  }
  return raw;
}

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
   * 工具所在目录路径（由子类通过 toolDir(import.meta.url) 设置）
   * 用于读取 schema.json 和 TOOL.md
   */
  readonly schemaDir?: string;

  /**
   * 可选：用 Zod 定义工具参数
   * 设置后，nativeToolSchemas() 会优先使用 zodParameters 转换的 JSON Schema
   */
  readonly zodParameters?: z.ZodTypeAny;

  /**
   * 获取工具的原生 schema（用于发送给 LLM）
   * 优先级：schema.json 文件 > zodParameters > definition.parameters
   */
  nativeToolSchemas(): JsonSchema[] {
    const { name, description, parameters } = this.definition;
    if (!name) return [];

    // 1. 优先从 schema.json 文件读取（最完整、最权威）
    if (this.schemaDir) {
      const schemaPath = join(this.schemaDir, "schema.json");
      if (existsSync(schemaPath)) {
        try {
          const data = JSON.parse(readFileSync(schemaPath, "utf-8"));
          if (Array.isArray(data)) return data;
          if (data && typeof data === "object") return [data];
        } catch { /* fallthrough */ }
      }
    }

    // 2. 如果定义了 zodParameters，使用 zod-to-json-schema 转换
    if (this.zodParameters) {
      try {
        const { zodToJsonSchema } = require("./schema-utils.js") as typeof import("./schema-utils.js");
        const jsonSchema = zodToJsonSchema(this.zodParameters, name);
        return [
          {
            type: "object",
            name,
            description: description || name,
            parameters: jsonSchema,
          },
        ];
      } catch {
        // 转换失败，回退到 definition.parameters
      }
    }

    // 3. 回退到 definition.parameters
    return [
      {
        type: "object",
        name,
        description: description || name,
        parameters,
      },
    ];
  }

  /**
   * 获取工具提示词（TOOL.md），用于注入 system prompt 的工具使用指导区域
   * 返回 null 表示该工具没有提示词文件
   */
  toolPrompt(): string | null {
    if (!this.schemaDir) return null;
    const promptPath = join(this.schemaDir, "TOOL.md");
    if (!existsSync(promptPath)) return null;
    try {
      return readFileSync(promptPath, "utf-8");
    } catch {
      return null;
    }
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
