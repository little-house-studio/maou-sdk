/**
 * AWS Bedrock 适配器
 *
 * 实现 ProtocolAdapter 接口，将统一消息格式转换为 AWS Bedrock Converse API 格式。
 * Converse API 是 provider-agnostic 的统一接口，支持 Claude / Llama / Mistral / Titan 等模型。
 *
 * 认证：使用 AWS SigV4 签名（通过 @smithy/signature-v4 + @aws-crypto/sha256-js）
 * 凭证：使用 @aws-sdk/credential-provider-node 的 defaultProvider 链
 *
 * 端点：
 * - 非流式：POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
 * - 流式：  POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse-stream
 *
 * 使用 partial-json 库解析流式工具调用参数。
 */

import type {
  ProtocolAdapter,
  APIPreset,
  ParsedLLMResponse,
  LLMToolCall,
  StreamEvent,
} from "./types.js";
import { parseToolArguments, normalizeToolParametersSchema, MAX_TOKENS_CAP } from "./shared.js";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import type { AwsCredentialIdentity, Provider, HttpRequest as SmithyHttpRequest } from "@smithy/types";

/** Bedrock 默认区域 */
const DEFAULT_REGION = "us-east-1";

/** 从 preset.url 中提取 AWS region */
function extractRegion(preset: APIPreset): string {
  // 优先使用 preset.region / preset.aws_region
  const regionFromPreset = (preset as Record<string, unknown>).region
    ?? (preset as Record<string, unknown>).aws_region;
  if (typeof regionFromPreset === "string" && regionFromPreset.trim()) {
    return regionFromPreset.trim();
  }
  // 从 URL 中提取 region：https://bedrock-runtime.{region}.amazonaws.com/...
  const url = String(preset.url ?? "");
  const match = url.match(/bedrock-runtime\.([^.]+)\.amazonaws\.com/);
  if (match && match[1]) return match[1];
  // 从环境变量读取
  const envRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (envRegion) return envRegion;
  return DEFAULT_REGION;
}

/** 从 preset.url 中提取 modelId */
function extractModelId(preset: APIPreset): string {
  // preset.model 可能是 Bedrock modelId（如 "anthropic.claude-3-5-sonnet-20241022-v2:0"）
  const model = String(preset.model ?? "").trim();
  if (model) return model;
  // 从 URL 路径中提取
  const url = String(preset.url ?? "");
  const match = url.match(/\/model\/([^/]+)/);
  if (match && match[1]) return decodeURIComponent(match[1]);
  return "";
}

export class BedrockAdapter implements ProtocolAdapter {
  readonly protocolName = "bedrock";

  // 凭证提供者懒加载：@aws-sdk/credential-provider-node 是 node-only 依赖，
  // 用动态 import 推迟到首次签名时加载，避免把它带进浏览器静态依赖图。
  private _credentialProvider: Provider<AwsCredentialIdentity> | null = null;
  private _cachedCredentials: AwsCredentialIdentity | null = null;
  private _credentialsExpiry: number = 0;

  /** 异步获取凭证（带缓存，提前 5 分钟刷新） */
  private async _getCredentials(): Promise<AwsCredentialIdentity> {
    const now = Date.now();
    if (this._cachedCredentials && now < this._credentialsExpiry - 5 * 60 * 1000) {
      return this._cachedCredentials;
    }
    if (!this._credentialProvider) {
      const { defaultProvider } = await import("@aws-sdk/credential-provider-node");
      this._credentialProvider = defaultProvider();
    }
    this._cachedCredentials = await this._credentialProvider();
    // 凭证过期时间（如果有的话），否则默认 1 小时
    const expiration = this._cachedCredentials.expiration;
    this._credentialsExpiry = expiration ? expiration.getTime() : now + 3600 * 1000;
    return this._cachedCredentials;
  }

  buildRequestHeaders(_preset: APIPreset): Record<string, string> {
    // Bedrock 的签名依赖 body，所以这里只返回基础 headers
    // 真正的签名在 signRequest 方法中完成
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * 对 Bedrock 请求进行 SigV4 签名
   * 此方法在 LLMClient 发送请求前被调用，生成完整的签名 headers
   */
  async signRequest(
    url: string,
    headers: Record<string, string>,
    body: string,
    preset: APIPreset,
  ): Promise<Record<string, string>> {
    const region = extractRegion(preset);
    const signer = new SignatureV4({
      credentials: () => this._getCredentials(),
      region,
      service: "bedrock",
      sha256: Sha256,
    });

    const parsedUrl = new URL(url);
    const httpRequest: SmithyHttpRequest = {
      method: "POST",
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
      path: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams.entries()),
      headers: {
        ...headers,
        host: parsedUrl.host,
      },
      body,
    };

    const signedRequest = await signer.sign(httpRequest);
    // 返回签名后的 headers（排除 host，因为 fetch 会自动设置）
    const signedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(signedRequest.headers)) {
      if (key.toLowerCase() === "host") continue;
      signedHeaders[key] = String(value);
    }
    return signedHeaders;
  }

  private _buildTools(toolSchemas: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    for (const schema of toolSchemas ?? []) {
      const name = String((schema as Record<string, unknown>).name ?? "").trim();
      if (!name) continue;
      tools.push({
        toolSpec: {
          name,
          description: String((schema as Record<string, unknown>).description ?? name),
          inputSchema: {
            json: normalizeToolParametersSchema((schema as Record<string, unknown>).parameters),
          },
        },
      });
    }
    return tools;
  }

  /**
   * 将 OpenAI 风格消息数组转换为 Bedrock Converse API 格式
   * Converse API 使用 content blocks（[{text: "..."}, {image: {...}}]）
   */
  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    const converseMessages: Record<string, unknown>[] = [];

    for (const message of messages) {
      const role = String(message.role ?? "");
      const rawContent = message.content;

      if (role === "system") {
        // system 消息由 buildRequestPayload 单独提取
        continue;
      }
      if (role === "tool") {
        // 工具结果作为 user 消息注入，使用 toolResult content block
        const toolCallId = message.tool_call_id;
        const content = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
        converseMessages.push({
          role: "user",
          content: [{
            toolResult: {
              toolUseId: String(toolCallId ?? ""),
              content: [{ text: content }],
            },
          }],
        });
        continue;
      }

      if (role !== "user" && role !== "assistant") continue;

      // 处理 assistant 消息中的 tool_calls
      const toolCalls = (message as Record<string, unknown>).tool_calls as Record<string, unknown>[] | undefined;
      if (role === "assistant" && toolCalls && toolCalls.length > 0) {
        const contentBlocks: Record<string, unknown>[] = [];
        // 如果有文本内容，先加文本
        if (typeof rawContent === "string" && rawContent.trim()) {
          contentBlocks.push({ text: rawContent });
        }
        for (const tc of toolCalls) {
          const fn = (tc.function as Record<string, unknown>) ?? tc;
          const name = String(fn.name ?? "");
          const args = fn.arguments;
          let inputObj: Record<string, unknown>;
          if (typeof args === "string") {
            inputObj = this.parseToolArguments(args);
          } else if (args && typeof args === "object") {
            inputObj = args as Record<string, unknown>;
          } else {
            inputObj = {};
          }
          contentBlocks.push({
            toolUse: {
              toolUseId: String(tc.id ?? ""),
              name,
              input: inputObj,
            },
          });
        }
        converseMessages.push({ role: "assistant", content: contentBlocks });
        continue;
      }

      // 处理多模态 user 消息
      if (role === "user" && Array.isArray(rawContent)) {
        const contentBlocks = this._convertMultimodalContent(rawContent);
        converseMessages.push({ role: "user", content: contentBlocks });
        continue;
      }

      // 纯文本消息
      const text = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
      converseMessages.push({ role, content: [{ text }] });
    }

    return converseMessages;
  }

  /** 将 OpenAI 格式的多模态内容转换为 Bedrock Converse 格式 */
  private _convertMultimodalContent(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const part of parts) {
      if (part.type === "image_url") {
        const imageUrl = (part.image_url as Record<string, unknown>)?.url as string ?? "";
        const dataUriMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          result.push({
            image: {
              format: dataUriMatch[1].split("/")[1] ?? "png",
              source: {
                bytes: dataUriMatch[2],
              },
            },
          });
        }
      } else if (part.type === "text") {
        result.push({ text: String(part.text ?? "") });
      }
    }
    return result;
  }

  /** 从消息中提取 system prompt */
  private _extractSystemMessage(messages: Record<string, unknown>[]): Array<{ text: string }> {
    const systemBlocks: Array<{ text: string }> = [];
    for (const message of messages) {
      if (String(message.role ?? "") === "system") {
        const content = typeof message.content === "string"
          ? message.content
          : String(message.content ?? "");
        if (content.trim()) {
          systemBlocks.push({ text: content });
        }
      }
    }
    return systemBlocks;
  }

  buildRequestPayload(params: {
    preset: APIPreset;
    messages: Record<string, unknown>[];
    stream: boolean;
    toolSchemas?: Record<string, unknown>[] | null;
    jsonSettings?: Record<string, unknown> | null;
    nativeToolCalling?: boolean;
    structuredOutputSchema?: Record<string, unknown> | null;
  }): Record<string, unknown> {
    const { preset, messages, stream, toolSchemas, nativeToolCalling } = params;
    const converseMessages = this.normalizeMessages(messages);
    const systemBlocks = this._extractSystemMessage(messages);

    const payload: Record<string, unknown> = {
      messages: converseMessages,
    };

    if (systemBlocks.length > 0) {
      payload.system = systemBlocks;
    }

    // inferenceConfig
    const inferenceConfig: Record<string, unknown> = {
      maxTokens: Math.min(Number(preset.maxTokens ?? 65536) || 65536, MAX_TOKENS_CAP),
    };
    // 透传 temperature / topP（如果 preset 中有）
    if (typeof preset.temperature === "number") {
      inferenceConfig.temperature = preset.temperature;
    }
    if (typeof preset.top_p === "number") {
      inferenceConfig.topP = preset.top_p;
    }
    payload.inferenceConfig = inferenceConfig;

    // 工具配置
    if (nativeToolCalling) {
      const tools = this._buildTools(toolSchemas);
      if (tools.length) {
        payload.toolConfig = {
          tools,
          toolChoice: { auto: {} },
        };
      }
    }

    // 注入 reasoning_params —— Bedrock Converse API 通过 inferenceConfig 中的 thinking 字段控制
    // （仅 Anthropic Claude 模型支持）
    const reasoningParams = preset.reasoning_params;
    if (reasoningParams && typeof reasoningParams === "object") {
      const rp = reasoningParams as Record<string, unknown>;
      if (rp.thinking && typeof rp.thinking === "object") {
        const thinking = rp.thinking as Record<string, unknown>;
        if (thinking.type === "enabled") {
          const budget = Number(thinking.budget_tokens ?? 0);
          (inferenceConfig as Record<string, unknown>).thinking = {
            type: "enabled",
            budgetTokens: budget,
          };
        } else if (thinking.type === "disabled") {
          (inferenceConfig as Record<string, unknown>).thinking = {
            type: "disabled",
          };
        }
      } else if (rp.reasoning_effort) {
        // OpenAI 风格 reasoning_effort → Bedrock thinking
        const effort = String(rp.reasoning_effort);
        const budget = effort === "low" ? 1024 : effort === "medium" ? 4096 : 16384;
        (inferenceConfig as Record<string, unknown>).thinking = {
          type: "enabled",
          budgetTokens: budget,
        };
      }
    }

    return payload;
  }

  parseNonstreamResponse(data: Record<string, unknown>): ParsedLLMResponse {
    // Bedrock 错误检测
    if (data.error) {
      const errObj = data.error as Record<string, unknown>;
      const errMsg = String(errObj.message ?? errObj.type ?? JSON.stringify(data.error));
      throw new Error(`Bedrock API error: ${errMsg}`);
    }

    const output = (data.output as Record<string, unknown>) ?? {};
    const message = (output.message as Record<string, unknown>) ?? {};
    const contentBlocks = (message.content as Record<string, unknown>[]) ?? [];

    let body = "";
    let reasoningContent = "";
    const toolCalls: LLMToolCall[] = [];

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i];
      if (!block || typeof block !== "object") continue;

      if (typeof block.text === "string") {
        body += block.text;
      }
      if (typeof block.reasoningContent === "object" && block.reasoningContent !== null) {
        const rc = block.reasoningContent as Record<string, unknown>;
        if (typeof rc.text === "string") {
          reasoningContent += rc.text;
        }
      }
      if (block.toolUse && typeof block.toolUse === "object") {
        const tu = block.toolUse as Record<string, unknown>;
        const name = String(tu.name ?? "").trim();
        if (name) {
          const input = tu.input;
          toolCalls.push({
            id: String(tu.toolUseId ?? `bedrock_call_${i}`),
            name,
            parameters: input && typeof input === "object" && !Array.isArray(input)
              ? input as Record<string, unknown>
              : this.parseToolArguments(input),
            provider: "bedrock",
            type: "toolUse",
          });
        }
      }
    }

    const stopReasonRaw = data.stopReason;
    const finishReason =
      typeof stopReasonRaw === "string" && stopReasonRaw ? stopReasonRaw : null;

    return {
      content: body,
      toolCalls,
      finishReason,
      usedReasoning: !!reasoningContent,
      reasoningContent: reasoningContent || undefined,
    };
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): StreamEvent {
    // Bedrock 流式错误检测
    if (data.error) {
      const errObj = data.error as Record<string, unknown>;
      const errMsg = String(errObj.message ?? errObj.type ?? JSON.stringify(data.error));
      throw new Error(`LLM stream error: ${errMsg}`);
    }

    const eventType = String(data.type ?? data.eventType ?? data._eventType ?? "");
    let delta = "";
    let thinking = "";

    // Converse Stream API 事件类型
    if (eventType === "contentBlockDelta") {
      const contentBlockDelta = (data.delta as Record<string, unknown>) ?? {};
      if (typeof contentBlockDelta.text === "string") {
        delta = contentBlockDelta.text;
      }
      if (typeof contentBlockDelta.reasoningContent === "object" && contentBlockDelta.reasoningContent !== null) {
        const rc = contentBlockDelta.reasoningContent as Record<string, unknown>;
        if (typeof rc.text === "string") {
          thinking = rc.text;
        }
      }
      // 工具调用参数增量（Bedrock 使用 toolUse.input 增量）
      if (typeof contentBlockDelta.toolUse === "object" && contentBlockDelta.toolUse !== null) {
        const tu = contentBlockDelta.toolUse as Record<string, unknown>;
        if (typeof tu.input === "string") {
          const blockIdx = Number(data.contentBlockIndex ?? 0);
          let chunk = toolChunks.get(blockIdx);
          if (!chunk) {
            chunk = { id: "", name: "", arguments: "" };
            toolChunks.set(blockIdx, chunk);
          }
          chunk.arguments += tu.input;
        }
      }
    } else if (eventType === "contentBlockStart") {
      const contentBlockStart = (data.start as Record<string, unknown>) ?? {};
      if (contentBlockStart.toolUse && typeof contentBlockStart.toolUse === "object") {
        const tu = contentBlockStart.toolUse as Record<string, unknown>;
        const blockIdx = Number(data.contentBlockIndex ?? 0);
        toolChunks.set(blockIdx, {
          id: String(tu.toolUseId ?? ""),
          name: String(tu.name ?? ""),
          arguments: "",
        });
      }
    }

    const finishReasonRaw = data.stopReason;
    const finishReason =
      typeof finishReasonRaw === "string" && finishReasonRaw ? finishReasonRaw : null;

    return { delta, finishReason, usedReasoning: !!thinking, thinking: thinking || undefined };
  }

  collectToolCalls(
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): LLMToolCall[] {
    const toolCalls: LLMToolCall[] = [];
    const sorted = [...toolChunks.entries()].sort((a, b) => a[0] - b[0]);
    for (const [index, chunk] of sorted) {
      const name = chunk.name.trim();
      if (!name) continue;
      toolCalls.push({
        id: chunk.id || `bedrock_call_${index}`,
        name,
        parameters: this.parseToolArguments(chunk.arguments),
        provider: "bedrock",
        type: "toolUse",
      });
    }
    return toolCalls;
  }

  parseToolArguments = parseToolArguments;
}
