/**
 * defineTool — 文件即工具 API（对标 Vercel Eve）
 *
 * 用法：在 agent/tools/ 目录下创建 .ts 文件，导出 defineTool() 的返回值。
 * 文件名即工具名（如 get_weather.ts → 工具名 "get_weather"）。
 *
 * @example
 * // agent/tools/get_weather.ts
 * import { defineTool } from "@little-house-studio/tools/define";
 * import { z } from "zod";
 *
 * export default defineTool({
 *   description: "获取指定城市的天气数据",
 *   inputSchema: z.object({ city: z.string().min(1) }),
 *   outputSchema: z.object({ city: z.string(), condition: z.string(), temperatureC: z.number() }),
 *   async execute({ city }) {
 *     return { city, condition: "晴天", temperatureC: 22 };
 *   },
 * });
 */

import type { z } from "zod";
import type { Tool, ToolContext, ToolResponse, JsonSchema } from "./base.js";
import { createToolResponse } from "./base.js";
import { zodToJsonSchema, zodToToolSchema } from "./schema-utils.js";

// ─── 审批策略 ──────────────────────────────────────────────────────────────

/** 审批决策 */
export type ApprovalDecision = boolean;

/**
 * 审批策略函数
 * 接收工具名和输入参数，返回是否需要人类审批
 */
export type ApprovalPredicate = (input: {
  toolName: string;
  toolInput: Record<string, unknown>;
}) => ApprovalDecision | Promise<ApprovalDecision>;

/**
 * 审批策略构建器（对标 Eve 的 always / once / predicate）
 */
export const approval = {
  /** 每次调用都需要审批 */
  always(): ApprovalPredicate {
    return () => true;
  },

  /** 只在首次调用时需要审批，之后自动通过 */
  once(): ApprovalPredicate {
    let approved = false;
    return () => {
      if (approved) return false;
      approved = true;
      return true;
    };
  },

  /** 根据输入动态决定是否需要审批 */
  when(predicate: (toolInput: Record<string, unknown>) => boolean): ApprovalPredicate {
    return ({ toolInput }) => predicate(toolInput);
  },

  /** 从不审批（默认行为） */
  never(): ApprovalPredicate {
    return () => false;
  },
};

// ─── toModelOutput ─────────────────────────────────────────────────────────

/**
 * 工具输出精简函数
 * 将完整的工具返回值精简为模型需要看到的内容
 */
export type ToModelOutput<T = unknown> = (output: T) => ModelOutputValue;

/** 模型输出值 */
export type ModelOutputValue =
  | { type: "text"; value: string }
  | { type: "json"; value: unknown }
  | string;

// ─── defineTool 配置 ───────────────────────────────────────────────────────

export interface DefineToolConfig<
  Input extends z.ZodTypeAny = z.ZodTypeAny,
  Output = unknown,
> {
  /** 工具描述（发送给 LLM） */
  description: string;

  /** 输入参数 Zod schema */
  inputSchema: Input;

  /** 输出参数 Zod schema（可选，用于输出校验） */
  outputSchema?: z.ZodTypeAny;

  /** 是否需要人类审批（默认 false） */
  needsApproval?: ApprovalPredicate | boolean;

  /** 工具输出精简（可选，将完整输出精简为模型需要看到的内容） */
  toModelOutput?: ToModelOutput<Output>;

  /** 工具执行函数 */
  execute: (args: z.infer<Input>) => Promise<Output> | Output;
}

// ─── DefinedTool 结果 ──────────────────────────────────────────────────────

/**
 * defineTool 返回的工具对象
 * 实现了 Tool 抽象基类接口，可直接注册到 ToolRegistry
 */
export class DefinedToolAdapter implements Tool {
  readonly definition: import("./base.js").ToolDefinition;
  readonly zodParameters: z.ZodTypeAny;

  private _config: DefineToolConfig;
  private _toolName: string;
  private _approvalPredicate: ApprovalPredicate;
  private _outputSchema?: z.ZodTypeAny;

  constructor(name: string, config: DefineToolConfig) {
    this._toolName = name;
    this._config = config;
    this._outputSchema = config.outputSchema;

    // 构建 approval predicate
    if (config.needsApproval === true) {
      this._approvalPredicate = approval.always();
    } else if (config.needsApproval === false || config.needsApproval == null) {
      this._approvalPredicate = approval.never();
    } else {
      this._approvalPredicate = config.needsApproval;
    }

    // 构建 ToolDefinition
    const jsonSchema = zodToJsonSchema(config.inputSchema);
    this.definition = {
      name,
      aliases: [],
      description: config.description,
      parameters: {
        type: "object",
        ...jsonSchema,
      },
      allowedModes: null, // 文件即工具默认所有模式可用
    };

    this.zodParameters = config.inputSchema;
  }

  /** 工具名 */
  get toolName(): string {
    return this._toolName;
  }

  /** 是否需要人类审批 */
  async needsApprovalFor(toolInput: Record<string, unknown>): Promise<boolean> {
    return this._approvalPredicate({ toolName: this._toolName, toolInput });
  }

  /** 获取 LLM 可见的 schema */
  nativeToolSchemas(): JsonSchema[] {
    const schema = zodToToolSchema(this._toolName, this._config.description, this._config.inputSchema);
    return [{ type: "object", ...schema } as JsonSchema];
  }

  /** 执行工具 */
  async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    try {
      // Zod 校验 + 强转
      const parsed = this._config.inputSchema.safeParse(params);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        return createToolResponse(false, `参数校验失败: ${errors.join("; ")}`);
      }

      // 执行
      const result = await this._config.execute(parsed.data);

      // outputSchema 校验（可选）
      if (this._outputSchema) {
        const outputParsed = this._outputSchema.safeParse(result);
        if (!outputParsed.success) {
          const errors = outputParsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
          return createToolResponse(false, `输出校验失败: ${errors.join("; ")}`);
        }
      }

      // toModelOutput 精简
      let message: string;
      if (this._config.toModelOutput) {
        const modelOutput = this._config.toModelOutput(result);
        if (typeof modelOutput === "string") {
          message = modelOutput;
        } else if (modelOutput.type === "text") {
          message = modelOutput.value;
        } else {
          message = JSON.stringify(modelOutput.value, null, 2);
        }
      } else {
        message = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      }

      return createToolResponse(true, message, {
        payload: { result },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, `工具 ${this._toolName} 执行异常: ${msg}`);
    }
  }
}

/**
 * 定义一个文件即工具
 *
 * @param config - 工具配置
 * @returns DefinedToolAdapter 实例，可直接注册到 ToolRegistry
 *
 * @example
 * export default defineTool({
 *   description: "获取天气",
 *   inputSchema: z.object({ city: z.string() }),
 *   needsApproval: approval.always(),
 *   async execute({ city }) {
 *     return { city, temp: 22 };
 *   },
 * });
 */
export function defineTool<
  Input extends z.ZodTypeAny = z.ZodTypeAny,
  Output = unknown,
>(config: DefineToolConfig<Input, Output>): (name: string) => DefinedToolAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (name: string) => new DefinedToolAdapter(name, config as unknown as DefineToolConfig<z.ZodTypeAny, any>);
}
