/**
 * 工具执行管道
 * 对应 Python: core/tools/executor.py
 * 封装工具调用、超时处理与事件发射
 */

import type { Tool, ToolContext, ToolResponse, ToolCall } from "./base.js";
import { createToolResponse } from "./base.js";
import type { ToolRegistry } from "./registry.js";

/** 事件发射器类型 */
export type EventEmitFn = (
  event: string,
  data: Record<string, unknown>,
) => Record<string, unknown>;

/** 执行结果包装 */
export interface ToolExecutionResult {
  toolCall: ToolCall;
  events: Record<string, unknown>[];
  result: ToolResponse;
}

/** ToolExecutor 配置 */
export interface ToolExecutorConfig {
  /** 默认超时时间（毫秒），默认 30000 */
  defaultTimeoutMs?: number;
  /** 最大并发数 */
  maxConcurrency?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ToolExecutor {
  private _registry: ToolRegistry;
  private _timeoutMs: number;
  private _maxConcurrency: number;

  constructor(registry: ToolRegistry, config?: ToolExecutorConfig) {
    this._registry = registry;
    this._timeoutMs = config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._maxConcurrency = config?.maxConcurrency ?? 10;
  }

  /**
   * 执行单个工具调用（带权限检查和超时）
   */
  async executeSingle(
    toolCall: ToolCall,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> {
    const tool = this._registry.get(toolCall.name);

    if (!tool) {
      return {
        toolCall,
        events: [],
        result: createToolResponse(false, `不支持的工具: ${toolCall.name}`),
      };
    }

    // 权限检查：工具是否在当前模式下可用
    if (
      tool.definition.allowedModes !== null &&
      !tool.definition.allowedModes.includes(ctx.agentMode)
    ) {
      return {
        toolCall,
        events: [],
        result: createToolResponse(
          false,
          `工具 '${toolCall.name}' 在 ${ctx.agentMode} 模式下不可用`,
        ),
      };
    }

    // 带超时的执行
    try {
      const result = await this._executeWithTimeout(tool, toolCall, ctx);
      return { toolCall, events: [], result };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : String(err);
      return {
        toolCall,
        events: [],
        result: createToolResponse(
          false,
          `工具 ${toolCall.name} 执行异常: ${msg}`,
        ),
      };
    }
  }

  /**
   * 批量执行工具调用（并行，带并发控制）
   */
  async executeAll(
    toolCalls: ToolCall[],
    ctx: ToolContext,
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    // 分批执行，控制并发
    for (let i = 0; i < toolCalls.length; i += this._maxConcurrency) {
      const batch = toolCalls.slice(i, i + this._maxConcurrency);
      const batchResults = await Promise.all(
        batch.map((tc) => this.executeSingle(tc, ctx)),
      );
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * 带超时的工具执行
   */
  private async _executeWithTimeout(
    tool: Tool,
    toolCall: ToolCall,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const params = { ...toolCall.parameters, __tool_name__: toolCall.name };

    const execPromise = tool.execute(params, ctx);

    if (this._timeoutMs <= 0) {
      return execPromise;
    }

    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `工具 ${toolCall.name} 执行超时（${this._timeoutMs / 1000}秒）`,
          ),
        );
      }, this._timeoutMs);

      execPromise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
