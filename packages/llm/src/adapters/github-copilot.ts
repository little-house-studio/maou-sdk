/**
 * GitHub Copilot 适配器
 *
 * GitHub Copilot 的 Chat 端点（https://api.githubcopilot.com/chat/completions）与
 * OpenAI Chat Completions 请求/响应格式完全兼容，区别仅在于认证与一组 Copilot
 * 专属请求头：
 *   1. 认证使用 `Authorization: Bearer {copilot_token}`（token 由 OAuth 设备码流程
 *      换取，见 core/llm/oauth/github-copilot）。
 *   2. 额外携带 `Copilot-Integration-Id`、`Editor-Version`、`Editor-Plugin-Version`、
 *      `Openai-Intent` 等 header，用于标识调用方为编辑器插件。
 *
 * 与 azure/cloudflare 一样采用组合方式：内部委托一个 OpenAIChatAdapter 实例处理
 * 全部通用逻辑（payload 构建、消息归一化、流式/非流式解析、工具调用收集），
 * 仅自行实现 protocolName 与请求头构建。
 */

import { OpenAIChatAdapter } from "./openai.js";
import { parseToolArguments } from "./shared.js";
import type {
  ProtocolAdapter,
  APIPreset,
  ParsedLLMResponse,
  LLMToolCall,
  StreamEvent,
} from "./types.js";

/** Copilot 集成标识默认值（标识调用方插件） */
const DEFAULT_INTEGRATION_ID = "vscode-chat";
/** Editor-Version 默认值 */
const DEFAULT_EDITOR_VERSION = "vscode/1.96.0";
/** Editor-Plugin-Version 默认值 */
const DEFAULT_PLUGIN_VERSION = "copilot-chat/0.23.0";

export class GitHubCopilotAdapter implements ProtocolAdapter {
  readonly protocolName = "github-copilot";

  /** 内部委托的 OpenAI Chat 适配器，复用全部通用逻辑 */
  private readonly _openai = new OpenAIChatAdapter();

  /** Copilot 使用 Bearer + 一组编辑器标识 header */
  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    const integrationId =
      typeof preset.integration_id === "string" && preset.integration_id.trim()
        ? preset.integration_id.trim()
        : DEFAULT_INTEGRATION_ID;
    const editorVersion =
      typeof preset.editor_version === "string" && preset.editor_version.trim()
        ? preset.editor_version.trim()
        : DEFAULT_EDITOR_VERSION;
    const pluginVersion =
      typeof preset.editor_plugin_version === "string" && preset.editor_plugin_version.trim()
        ? preset.editor_plugin_version.trim()
        : DEFAULT_PLUGIN_VERSION;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${preset.key ?? ""}`,
      "Content-Type": "application/json",
      "Copilot-Integration-Id": integrationId,
      "Editor-Version": editorVersion,
      "Editor-Plugin-Version": pluginVersion,
      "Openai-Intent": "conversation-panel",
      // X-Initiator 区分请求发起方：user（人在交互）/ agent（自动化）。
      // Copilot 后端据此做配额与策略区分。
      "X-Initiator": preset.initiator === "agent" ? "agent" : "user",
      "User-Agent": "GitHubCopilotChat/0.23.0",
    };

    // Copilot 的部分模型（视觉/大上下文）需要显式声明 vision 能力
    if (preset.supportsVision !== false) {
      headers["Copilot-Vision-Request"] = "true";
    }

    return headers;
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
    return this._openai.buildRequestPayload(params);
  }

  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    return this._openai.normalizeMessages(messages);
  }

  parseNonstreamResponse(data: Record<string, unknown>): ParsedLLMResponse {
    return this._openai.parseNonstreamResponse(data);
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): StreamEvent {
    return this._openai.parseStreamEvent(data, toolChunks);
  }

  collectToolCalls(
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): LLMToolCall[] {
    return this._openai.collectToolCalls(toolChunks);
  }

  parseToolArguments = parseToolArguments;
}
