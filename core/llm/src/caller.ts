/**
 * 模型调用管道 —— 封装流式/非流式调用 + JSON 校验与自动重试。
 * 对应 Python: core/llm/caller.py
 */

import type {
  APIPreset,
  ModelResponse,
  LLMUsage,
  LLMToolCall,
} from "./adapters/types.js";
import { normalizeApiProtocol } from "./adapters/types.js";
import type { LLMClient } from "./client.js";
import { detectToolCallFromPartialJson } from "./protocol/json-scan.js";
import { extractJsonCandidate } from "./protocol/json-extract.js";
import { validateParsedResponse } from "./protocol/json-validation.js";

/** 模型调用结果 */
export interface ModelCallResult {
  rawResponse: string;
  content: string;
  /** 完整思考/推理内容（若模型支持） */
  reasoningContent?: string;
  retryIndex: number;
  validationError: string;
  attemptDiagnostics: Record<string, unknown>[];
  nativeToolCalls: LLMToolCall[];
  usage: LLMUsage | null;
  rawRequest: Record<string, unknown> | null;
  rawSSEEvents: string[];
  /** 计时数据（毫秒） */
  timing?: {
    firstByteMs: number;
    generationMs: number;
    totalMs: number;
  };
  /** 流式被 abort 时已累积的内容（保留部分结果，上层不丢） */
  partial?: string;
  /** 本次调用是否因 abort 提前结束（true 时不重试） */
  aborted?: boolean;
}

/** 流式事件类型 */
export interface CallerStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

// ── 工具调用预校验/修补 ──

function repairToolCalls(toolCalls: LLMToolCall[], paramGuards?: Map<string, Set<string>>, getGuard?: (name: string) => Set<string> | undefined): LLMToolCall[] {
  if (!toolCalls?.length) return [];
  const ok: LLMToolCall[] = [];
  for (const call of toolCalls) {
    const guard = getGuard ? getGuard(call.name) : paramGuards?.get(call.name);
    if (guard) {
      if (guard.has("__need_cmd__") && !call.parameters.command) continue;
      const action = String(call.parameters.action ?? "");
      if (guard.has(action) && !call.parameters.text) continue;
    }
    ok.push(call);
  }
  return ok;
}

// ── 循环检测器 ──

class LoopDetector {
  private threshold: number;
  private minPatternLen: number;
  private buffer = "";

  constructor(threshold = 10, minPatternLen = 8) {
    this.threshold = Math.max(2, threshold);
    this.minPatternLen = Math.max(2, minPatternLen);
  }

  feed(newText: string): boolean {
    this.buffer += newText;
    if (this.buffer.length < this.minPatternLen * this.threshold) return false;
    return this._checkRepeatingPattern();
  }

  private _checkRepeatingPattern(): boolean {
    const buf = this.buffer;
    const bufLen = buf.length;
    const maxPatternLen = Math.floor(bufLen / this.threshold);

    for (let patLen = this.minPatternLen; patLen <= maxPatternLen; patLen++) {
      const pattern = buf.slice(-patLen);
      if (buf.endsWith(pattern.repeat(this.threshold))) return true;
    }
    return false;
  }
}

// ── ModelCaller ──

/**
 * 模型调用管道
 * 对应 Python: ModelCaller
 */
export class ModelCaller {
  private client: LLMClient;
  private emitEvent: (type: string, data: Record<string, unknown>) => CallerStreamEvent;
  private emitLog: (level: string, message: string) => CallerStreamEvent;
  private maxRetries: number;
  private loopThreshold: number;
  private paramGuards: Map<string, Set<string>>;

  constructor(params: {
    client: LLMClient;
    emitEvent: (type: string, data: Record<string, unknown>) => CallerStreamEvent;
    emitLog: (level: string, message: string) => CallerStreamEvent;
    maxRetries?: number;
    loopThreshold?: number;
    toolRegistry?: { get(name: string): { definition: { paramGuards?: Record<string, string> } } | undefined };
  }) {
    this.client = params.client;
    this.emitEvent = params.emitEvent;
    this.emitLog = params.emitLog;
    this.maxRetries = params.maxRetries ?? 3;
    this.loopThreshold = params.loopThreshold ?? 10;

    // 从工具注册表构建参数校验规则
    this.paramGuards = new Map();
    if (params.toolRegistry) {
      this._toolRegistry = params.toolRegistry;
    }
  }

  private _toolRegistry?: { get(name: string): { definition: { paramGuards?: Record<string, string> } } | undefined };

  /**
   * 获取工具的参数校验规则（延迟构建，缓存结果）
   */
  private _getGuard(toolName: string): Set<string> | undefined {
    if (this.paramGuards.has(toolName)) return this.paramGuards.get(toolName);
    const tool = this._toolRegistry?.get(toolName);
    if (!tool?.definition?.paramGuards) {
      this.paramGuards.set(toolName, undefined as unknown as Set<string>);
      return undefined;
    }
    const guards = new Set(Object.keys(tool.definition.paramGuards));
    this.paramGuards.set(toolName, guards);
    return guards;
  }

  /**
   * 流式调用模型
   * 对应 Python: call_stream
   * yields CallerStreamEvent, returns ModelCallResult
   */
  async *callStream(params: {
    sessionId: string;
    roundIndex: number;
    preset: APIPreset;
    messages: Record<string, unknown>[];
    autoFormat: boolean;
    jsonSettings: Record<string, unknown> | null;
    stream: boolean;
    toolSchemas?: Record<string, unknown>[] | null;
    nativeToolCalling?: boolean;
    /** 中断信号，透传到底层 fetch */
    abortSignal?: AbortSignal;
  }): AsyncGenerator<CallerStreamEvent, ModelCallResult> {
    const {
      sessionId,
      roundIndex,
      preset,
      messages,
      autoFormat,
      jsonSettings,
      stream,
      toolSchemas,
      nativeToolCalling,
      abortSignal,
    } = params;

    let lastResponse = "";
    let lastUsage: LLMUsage | null = null;
    let lastModelResponse: ModelResponse | null = null;
    const attemptDiagnostics: Record<string, unknown>[] = [];
    let baseNormalizedMessages = [...messages];
    const modelName = preset.model ?? "?";

    this.emitLog("info", `[MODEL] callStream start stream=${stream} model=${modelName} round=${roundIndex}`);

    for (let retry = 0; retry <= this.maxRetries; retry++) {
      yield this.emitTraceEvent(sessionId, "model.request", {
        round: roundIndex,
        retry,
        preset: {
          name: preset.name,
          model: preset.model,
          protocol: normalizeApiProtocol(preset.protocol),
        },
        stream,
        sent_count: baseNormalizedMessages.length,
      });

      try {
        if (stream) {
          let accumulatedResponse = "";
          let detectedTool: Record<string, unknown> | null = null;
          let loopDetected = false;
          const loopDetector = new LoopDetector(this.loopThreshold);

          const streamIter = this.client.chatStream({
            preset,
            messages: baseNormalizedMessages,
            jsonSettings,
            toolSchemas,
            nativeToolCalling,
            _logContext: { session_id: sessionId, round: roundIndex, retry },
            abortSignal,
          });

          let result = await streamIter.next();
          while (!result.done) {
            const delta = result.value;
            // 思考/推理内容增量
            if (delta.thinking) {
              yield this.emitEvent("thinking_delta", {
                round: roundIndex,
                delta: delta.thinking,
              });
            }
            if (delta.delta) {
              accumulatedResponse += delta.delta;
              yield this.emitEvent("assistant_delta", {
                round: roundIndex,
                delta: delta.delta,
                content_length: accumulatedResponse.length,
              });

              if (detectedTool === null) {
                detectedTool = detectToolCallFromPartialJson(accumulatedResponse);
                if (detectedTool) {
                  yield this.emitTraceEvent(sessionId, "model.tool_detected", {
                    round: roundIndex,
                    retry,
                    tool: detectedTool,
                  });
                  yield this.emitEvent("tool_pending", {
                    round: roundIndex,
                    tool: detectedTool,
                  });
                }
              }

              if (loopDetector.feed(delta.delta)) {
                loopDetected = true;
                break;
              }
            }
            result = await streamIter.next();
          }

          if (loopDetected) {
            lastResponse = accumulatedResponse;
            yield this.emitTraceEvent(sessionId, "model.loop_detected", {
              round: roundIndex,
              retry,
              content_length: accumulatedResponse.length,
            });
            yield this.emitLog("warn", `检测到循环输出，第 ${retry + 1} 次重试`);
            baseNormalizedMessages = [
              ...baseNormalizedMessages,
              {
                role: "user",
                content: "[系统提示] 检测到你的输出出现了循环重复。请跳出当前模式，使用不同的表达方式继续。",
              },
            ];
            continue;
          }

          // 当流结束时，result.value 是 ModelResponse（generator 的返回值）
          const response = result.value as ModelResponse;
          lastResponse = response.content || accumulatedResponse;
          lastUsage = response.usage ?? lastUsage;
          lastModelResponse = response;

          // abort：client 返回了带 partial 的响应。不重试，直接返回部分结果。
          if (response.aborted) {
            yield this.emitTraceEvent(sessionId, "model.aborted", {
              round: roundIndex,
              retry,
              partial_length: response.partial?.length ?? accumulatedResponse.length,
            });
            return {
              rawResponse: response.partial ?? accumulatedResponse,
              content: response.partial ?? accumulatedResponse,
              reasoningContent: response.reasoningContent,
              retryIndex: retry,
              validationError: "",
              attemptDiagnostics,
              nativeToolCalls: [],
              usage: lastUsage,
              rawRequest: response.rawPayload,
              rawSSEEvents: response.rawEvents,
              timing: response.timing,
              partial: response.partial ?? accumulatedResponse,
              aborted: true,
            };
          }
        } else {
          const response = await this.client.chat({
            preset,
            messages: baseNormalizedMessages,
            jsonSettings,
            toolSchemas,
            nativeToolCalling,
            _logContext: { session_id: sessionId, round: roundIndex, retry },
            abortSignal,
          });
          lastResponse = response.content;
          lastUsage = response.usage ?? lastUsage;
          lastModelResponse = response;

          // 非流式也做循环检测：对完整响应文本一次性 feed
          const loopDetector = new LoopDetector(this.loopThreshold);
          if (loopDetector.feed(lastResponse)) {
            yield this.emitTraceEvent(sessionId, "model.loop_detected", {
              round: roundIndex,
              retry,
              content_length: lastResponse.length,
            });
            yield this.emitLog("warn", `检测到循环输出（非流式），第 ${retry + 1} 次重试`);
            baseNormalizedMessages = [
              ...baseNormalizedMessages,
              {
                role: "user",
                content: "[系统提示] 检测到你的输出出现了循环重复。请跳出当前模式，使用不同的表达方式继续。",
              },
            ];
            continue;
          }
        }
      } catch (error) {
        yield this.emitTraceEvent(sessionId, "model.error", {
          round: roundIndex,
          retry,
          error: String(error),
        });

        // 可重试错误（原样重试，不降级、不注入错误到上下文）：
        // - 400 类
        // - 流式停滞（一个字没动超过 stall 阈值即中止）→ 这是用户要求的"流式停滞才重试"
        // - 连接/网络/超时类瞬时故障
        const errStr = String(error);
        const retryable =
          errStr.includes("400") ||
          errStr.includes("停滞") || errStr.includes("stall") ||
          errStr.includes("timeout") || errStr.includes("timed out") ||
          errStr.includes("ECONNRESET") || errStr.includes("ECONNREFUSED") ||
          errStr.includes("ETIMEDOUT") || errStr.includes("socket hang up") ||
          errStr.includes("network");
        if (retry < this.maxRetries && retryable) {
          const attempt = retry + 1;
          const delaySec = Math.min(2 ** retry, 16); // 指数退避：1,2,4,8,16s
          yield this.emitEvent("status", { text: `API error · Retrying in ${delaySec}s · attempt ${attempt}/${this.maxRetries}` });
          yield this.emitLog("warn", `请求失败可重试（${errStr.slice(0, 80)}），第 ${attempt}/${this.maxRetries} 次重试，${delaySec}s 后重试`);
          await new Promise(r => setTimeout(r, delaySec * 1000));
          continue;
        }
        throw error;
      }

      yield this.emitTraceEvent(sessionId, "model.response.raw", {
        round: roundIndex,
        retry,
        content_type: lastModelResponse?.contentType,
        finish_reason: lastModelResponse?.finishReason,
        http_status: lastModelResponse?.httpStatus,
        request_id: lastModelResponse?.requestId,
        protocol: lastModelResponse?.protocol,
        raw_event_count: lastModelResponse?.rawEventCount,
        reasoning_fallback_used: lastModelResponse?.reasoningFallbackUsed,
        first_output_seconds: lastModelResponse?.firstOutputSeconds,
        raw_content_length: lastResponse.length,
        native_tool_calls: lastModelResponse?.toolCalls ?? [],
      });

      // 处理原生工具调用
      if (lastModelResponse?.toolCalls?.length) {
        const repaired = repairToolCalls(lastModelResponse.toolCalls, this.paramGuards, this._getGuard.bind(this));
        const nativeToolCalls: LLMToolCall[] = repaired
          .filter((call) => call.name.trim())
          .map((call) => ({
            name: call.name,
            parameters: { ...call.parameters },
            id: call.id,
            provider: call.provider || normalizeApiProtocol(preset.protocol),
            type: call.type || "function",
          }));

        const diagnostic: Record<string, unknown> = {
          attempt: retry + 1,
          retry,
          valid: true,
          can_retry: false,
          error: "",
          raw_length: (lastModelResponse.content ?? "").length,
          content_length: (lastModelResponse.content ?? "").length,
          native_tool_call_count: nativeToolCalls.length,
          native_tool_names: nativeToolCalls.map((c) => c.name),
        };
        attemptDiagnostics.push(diagnostic);

        for (const toolCall of nativeToolCalls) {
          yield this.emitEvent("tool_pending", {
            round: roundIndex,
            tool: toolCall,
          });
        }

        this.emitLog("info", `[MODEL] tool_calls mode, ${nativeToolCalls.length} calls`);

        return {
          rawResponse: lastModelResponse.content ?? "",
          content: lastModelResponse.content ?? "",
          reasoningContent: lastModelResponse.reasoningContent,
          retryIndex: retry,
          validationError: "",
          attemptDiagnostics,
          nativeToolCalls,
          usage: lastUsage,
          rawRequest: lastModelResponse.rawPayload,
          rawSSEEvents: stream ? lastModelResponse.rawEvents : [],
          timing: lastModelResponse.timing,
        };
      }

      // 非 auto_format 模式直接返回
      if (!autoFormat) {
        const diagnostic: Record<string, unknown> = {
          attempt: retry + 1,
          retry,
          valid: true,
          can_retry: false,
          error: "",
          raw_length: lastResponse.length,
          content_length: lastResponse.length,
          raw_output_mode: true,
        };
        attemptDiagnostics.push(diagnostic);

        this.emitLog("info", `[MODEL] raw_output_mode, retry=${retry}`);

        return {
          rawResponse: lastResponse,
          content: lastResponse,
          reasoningContent: lastModelResponse?.reasoningContent,
          retryIndex: retry,
          validationError: "",
          attemptDiagnostics,
          nativeToolCalls: [],
          usage: lastUsage,
          rawRequest: lastModelResponse?.rawPayload ?? null,
          rawSSEEvents: stream ? lastModelResponse?.rawEvents ?? [] : [],
          timing: lastModelResponse?.timing,
        };
      }

      // auto_format 模式：应用 JSON 验证 + 字段级修复（仅修复不重试）
      let repairedContent = lastResponse;
      let repairsApplied: string[] = [];
      let validationError = "";
      if (jsonSettings && lastResponse) {
        try {
          const result = validateParsedResponse(
            lastResponse,
            (jsonSettings ?? {}) as Record<string, unknown>,
          );

          if (result.formatted) {
            // 验证通过或修复成功
            repairedContent = result.formatted;
            const diag = result.diagnostic as Record<string, unknown>;
            const repairInfo = diag.repair as Record<string, unknown> | undefined;
            if (repairInfo && Array.isArray(repairInfo.repairs_applied)) {
              repairsApplied = [...(repairInfo.repairs_applied as string[])];
            }
            if (repairsApplied.length > 0) {
              this.emitLog("info", `[MODEL] JSON 修复: ${repairsApplied.join(", ")}`);
            }
            if (!result.valid && result.error) {
              validationError = result.error;
              this.emitLog("warn", `[MODEL] JSON 验证警告: ${result.error}（已修复，不重试）`);
            }
          } else if (result.error) {
            // 验证失败且无法修复
            validationError = result.error;
            this.emitLog("warn", `[MODEL] JSON 验证失败: ${result.error}`);
            // 回退到 extractJsonCandidate 做基础修复
            const extraction = extractJsonCandidate(
              lastResponse,
              (jsonSettings ?? {}) as Record<string, unknown>,
            );
            if (extraction.candidateText) {
              try {
                const parsed = JSON.parse(extraction.candidateText);
                repairedContent = JSON.stringify(parsed);
                repairsApplied = [...extraction.repairsApplied];
              } catch {
                repairedContent = extraction.candidateText;
                repairsApplied = [...extraction.repairsApplied];
              }
            }
          }
        } catch {
          // 修复失败，保持原始内容
        }
      }

      const diagnostic: Record<string, unknown> = {
        attempt: retry + 1,
        retry,
        valid: !validationError,
        can_retry: false,
        error: validationError,
        raw_length: lastResponse.length,
        content_length: repairedContent.length,
        repairs_applied: repairsApplied,
      };
      attemptDiagnostics.push(diagnostic);

      this.emitLog("info", `[MODEL] auto_format_mode, retry=${retry}`);

      return {
        rawResponse: lastResponse,
        content: repairedContent,
        reasoningContent: lastModelResponse?.reasoningContent,
        retryIndex: retry,
        validationError,
        attemptDiagnostics,
        nativeToolCalls: [],
        usage: lastUsage,
        rawRequest: lastModelResponse?.rawPayload ?? null,
        rawSSEEvents: stream ? lastModelResponse?.rawEvents ?? [] : [],
        timing: lastModelResponse?.timing,
      };
    }

    // 所有重试耗尽
    return {
      rawResponse: lastResponse,
      content: lastResponse,
      reasoningContent: lastModelResponse?.reasoningContent,
      retryIndex: this.maxRetries,
      validationError: "已耗尽所有重试次数",
      attemptDiagnostics,
      nativeToolCalls: [],
      usage: lastUsage,
      rawRequest: lastModelResponse?.rawPayload ?? null,
      rawSSEEvents: [],
      timing: lastModelResponse?.timing,
    };
  }

  private emitTraceEvent(
    sessionId: string,
    eventType: string,
    data: Record<string, unknown>,
  ): CallerStreamEvent {
    return {
      type: eventType,
      data: { session_id: sessionId, ...data },
    };
  }

  // ── 工厂方法 ──

  /** 创建错误调用结果（供 harness 层使用，避免自行拼装 ModelCallResult） */
  static createErrorResult(error: string): ModelCallResult {
    return {
      rawResponse: `[API Error: ${error}]`,
      content: "",
      retryIndex: 0,
      validationError: error,
      attemptDiagnostics: [],
      nativeToolCalls: [],
      usage: null,
      rawRequest: null,
      rawSSEEvents: [],
    };
  }
}
