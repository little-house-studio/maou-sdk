/**
 * 工具执行管道
 * 封装工具调用、超时处理与事件发射
 */

import type { Tool, ToolContext, ToolResponse, ToolCall } from "./base.js";
import { resolveToolRuntimePorts } from "./base.js";
import { ensureToolError, toolFail, toolFailFromThrown } from "./errors.js";
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
  /** 默认超时时间（毫秒），0 表示无超时。默认 0 */
  defaultTimeoutMs?: number;
  /** 最大并发数 */
  maxConcurrency?: number;
}

const DEFAULT_TIMEOUT_MS = 0; // 无超时：Agent Loop 可能执行很长时间，工具不应被硬超时中断

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
      const name = String(toolCall.name ?? "").trim();
      let hint = "";
      // MCP：配置了 server 但未注册元工具 / 名字写错时的友好提示
      if (
        name === "mcp" ||
        name.startsWith("mcp_") ||
        name.startsWith("mcp.") ||
        name.includes("mcp list") ||
        name.includes("mcp__")
      ) {
        hint =
          "\n\n【MCP 提示】\n" +
          "- gateway 模式请调用工具名 `mcp`（不是 `mcp list`），参数如 " +
          '`{"action":"list"}` 或 `{"action":"call","name":"mcp__server__tool","arguments":{...}}`。\n' +
          "- 若仍报不支持：检查 agent 是否已启用 MCP（run 时连接 ~/.maou/mcp.json / agents/<name>/mcp.json），" +
          "以及 tools 白名单是否包含 `mcp`。\n" +
          "- flat 模式则直接调 `mcp__<server>__<tool>`，无元工具 `mcp`。";
      }
      const result = toolFail("unknown_tool", `不支持的工具: ${name}${hint}`, {
        code: "unknown_tool",
        details: { toolName: name },
      });
      noteToolExec(ctx, toolCall, result, 0);
      return {
        toolCall,
        events: [],
        result,
      };
    }

    // 权限检查：工具是否在当前模式下可用
    if (
      tool.definition.allowedModes !== null &&
      !tool.definition.allowedModes.includes(ctx.agentMode)
    ) {
      const result = toolFail(
        "mode_denied",
        `工具 '${toolCall.name}' 在 ${ctx.agentMode} 模式下不可用`,
        {
          code: "mode_denied",
          details: {
            toolName: toolCall.name,
            agentMode: ctx.agentMode,
            allowedModes: tool.definition.allowedModes,
          },
        },
      );
      noteToolExec(ctx, toolCall, result, 0);
      return {
        toolCall,
        events: [],
        result,
      };
    }

    // 带超时的执行
    const started = Date.now();
    try {
      const result = await this._executeWithTimeout(tool, toolCall, ctx);
      // 统一保证 ok:false 带 error 字段（含未走 createToolResponse 的实现）
      const wrapped = { toolCall, events: [], result: ensureToolError(result) };
      noteToolExec(ctx, toolCall, wrapped.result, Date.now() - started);
      return wrapped;
    } catch (err: unknown) {
      const result = toolFailFromThrown(err, {
        prefix: `工具 ${toolCall.name} 执行异常`,
        fallbackCategory: "execution",
        extras: { details: { toolName: toolCall.name } },
      });
      noteToolExec(ctx, toolCall, result, Date.now() - started);
      return {
        toolCall,
        events: [],
        result,
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

    // 优先使用工具级 timeoutMs，否则使用全局 defaultTimeoutMs
    const timeoutMs = tool.definition.timeoutMs ?? this._timeoutMs;

    const execPromise = tool.execute(params, ctx);

    if (timeoutMs <= 0) {
      return execPromise;
    }

    return new Promise<ToolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(
          `工具 ${toolCall.name} 执行超时（${timeoutMs / 1000}秒）`,
        );
        err.name = "TimeoutError";
        (err as Error & { code?: string }).code = "tool_timeout";
        reject(err);
      }, timeoutMs);

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

/** 所有工具执行自动入账；新工具不必再写落盘函数 */
function noteToolExec(
  ctx: ToolContext,
  toolCall: ToolCall,
  result: ToolResponse,
  durationMs: number,
): void {
  try {
    const ledger = resolveToolRuntimePorts(ctx).sessionLedger;
    if (!ledger) return;
    ledger.append("tool/exec", {
      name: toolCall.name,
      toolCallId: toolCall.id,
      ok: result.ok !== false,
      durationMs,
      ...(result.ok === false
        ? { error: String(result.message ?? "").slice(0, 300) }
        : {}),
    });
  } catch {
    /* 账本失败不影响工具 */
  }
}
