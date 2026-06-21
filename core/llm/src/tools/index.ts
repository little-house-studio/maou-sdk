/**
 * 类型安全工具定义 SDK（基于 TypeBox）
 *
 * 对标 pi-ai：用 TypeBox schema 定义工具参数，获得编译期类型推断（Static）+ 运行期
 * 校验（validateToolCall）。生成的 parameters 本身就是合法 JSON Schema，可直接交给
 * ChatSession.setTools / 各协议适配器。
 *
 * @example
 * const weather = defineTool({
 *   name: "get_weather",
 *   description: "查询天气",
 *   parameters: Type.Object({
 *     city: Type.String({ description: "城市名" }),
 *     unit: StringEnum(["c", "f"], { default: "c" }),
 *   }),
 *   execute: async ({ city, unit }) => `${city}: 26°${unit}`,  // city/unit 已是强类型
 * })
 * session.setTools([weather.toSchema()])
 */

import { Type } from "@sinclair/typebox";
import type { Static, TSchema, TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import type { LLMToolCall } from "../adapters/types.js";

// 透传 TypeBox 的核心导出，使用方无需再单独依赖 typebox
export { Type };
export type { Static, TSchema, TObject };

/** 工具的 OpenAI function 风格 schema（适配器消费的格式） */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 已定义的工具 */
export interface DefinedTool<S extends TObject = TObject> {
  name: string;
  description: string;
  /** TypeBox 参数 schema（同时也是 JSON Schema） */
  parameters: S;
  /** 可选的本地执行器（agentLoop / 手动循环可用） */
  execute?: (args: Static<S>) => unknown | Promise<unknown>;
  /** 转成适配器可用的工具 schema */
  toSchema(): ToolSchema;
}

/**
 * 定义一个类型安全工具。
 */
export function defineTool<S extends TObject>(config: {
  name: string;
  description: string;
  parameters: S;
  execute?: (args: Static<S>) => unknown | Promise<unknown>;
}): DefinedTool<S> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
    toSchema(): ToolSchema {
      return {
        name: config.name,
        description: config.description,
        // TypeBox schema 本身即 JSON Schema
        parameters: config.parameters as unknown as Record<string, unknown>,
      };
    },
  };
}

/** 校验结果 */
export interface ValidateResult<T> {
  ok: boolean;
  /** 校验/强转/补默认后的参数（即便 ok=false 也会带上尽力而为的结果） */
  value: T;
  /** 错误列表（ok=false 时有值） */
  errors?: string[];
}

/**
 * 编译后的校验器缓存（WeakMap 按 schema 引用缓存，避免每次调用重复编译）。
 * TypeCompiler 把 schema 编译成 JIT 校验函数，比 Value.Check 快一个量级；
 * 对 TypeCompiler 不支持的特殊 schema（如 Type.Unsafe / 自定义类型），回退到 Value。
 */
interface SchemaChecker {
  Check(value: unknown): boolean;
  Errors(value: unknown): Iterable<{ path: string; message: string }>;
}
const COMPILED_CACHE = new WeakMap<TObject, SchemaChecker>();

function compiledFor(schema: TObject): SchemaChecker {
  let compiled = COMPILED_CACHE.get(schema);
  if (!compiled) {
    try {
      compiled = TypeCompiler.Compile(schema) as SchemaChecker;
    } catch {
      // TypeCompiler 不认识的 schema → 回退到运行时 Value 校验
      compiled = {
        Check: (v: unknown) => Value.Check(schema, v),
        Errors: (v: unknown) => Value.Errors(schema, v),
      };
    }
    COMPILED_CACHE.set(schema, compiled);
  }
  return compiled;
}

/**
 * 校验一次工具调用的参数是否符合 schema。
 * 会先做类型强转（"5"→5）+ 补默认值，再用编译后的校验器（WeakMap 缓存）校验。
 */
export function validateToolCall<S extends TObject>(
  tool: DefinedTool<S>,
  call: Pick<LLMToolCall, "parameters">,
): ValidateResult<Static<S>> {
  const schema = tool.parameters;
  let candidate: unknown = call.parameters ?? {};
  try {
    candidate = Value.Convert(schema, candidate);
    candidate = Value.Default(schema, candidate);
  } catch {
    // 强转/默认失败时退回原值，交给 Check 报错
  }

  const compiled = compiledFor(schema);
  if (compiled.Check(candidate)) {
    return { ok: true, value: candidate as Static<S> };
  }

  const errors = [...compiled.Errors(candidate)].map(
    (e) => `${e.path || "/"}: ${e.message}`,
  );
  return { ok: false, value: candidate as Static<S>, errors };
}

/**
 * 字符串枚举辅助（编译期推断为联合字面量类型，且可被 TypeCompiler 编译）。
 * @example StringEnum(["c", "f"], { default: "c" })
 */
export function StringEnum<T extends readonly string[]>(
  values: T,
  options?: { description?: string; default?: T[number] },
): TSchema {
  // 用 Union(Literal...) 而非 Type.Unsafe，确保 TypeCompiler 能编译
  return Type.Union(values.map((v) => Type.Literal(v)), options) as unknown as TSchema;
}

/** 把一组 DefinedTool 批量转成适配器 schema 数组 */
export function toolSchemas(tools: DefinedTool[]): ToolSchema[] {
  return tools.map((t) => t.toSchema());
}
