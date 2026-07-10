/**
 * 协议工具函数 —— 协议名归一化 + URL 路径补全
 *
 * 从 adapters/types.ts 拆出：types.ts 只保留纯类型/接口定义，业务逻辑放这里。
 * types.ts 末尾 re-export 这两个函数，保证现有 import 路径（from "./types.js"）零改动。
 *
 * 对应 Python: core/llm/adapters/adapter.py normalize_api_protocol / complete_api_url
 */

import type { APIProtocol } from "./types.js";

/**
 * 标准化 API 协议名称
 * 对应 Python: core/llm/adapters/adapter.py normalize_api_protocol
 */
export function normalizeApiProtocol(value: unknown): APIProtocol {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["claude", "anthropic", "anthropic-messages"].includes(normalized)) {
    return "anthropic";
  }
  // openai-codex 必须在 responses 之前判断（codex 复用 Responses 协议但认证不同）
  if (["openai-codex", "codex", "openai_codex"].includes(normalized)) {
    return "openai-codex";
  }
  if (["responses", "openai-responses", "openai_responses"].includes(normalized)) {
    return "responses";
  }
  // google-vertex 必须在 google 之前判断（vertex 复用 Gemini 协议但认证/端点不同）
  if (["google-vertex", "vertex", "vertex-ai", "vertex_ai", "google_vertex"].includes(normalized)) {
    return "google-vertex";
  }
  if (["google", "gemini", "google-gemini", "google_gemini"].includes(normalized)) {
    return "google";
  }
  if (["mistral", "mistral-ai", "mistral_ai"].includes(normalized)) {
    return "mistral";
  }
  if (["bedrock", "aws-bedrock", "aws_bedrock", "amazon-bedrock"].includes(normalized)) {
    return "bedrock";
  }
  if (["azure", "azure-openai", "azure_openai", "azureopenai"].includes(normalized)) {
    return "azure";
  }
  if (["cloudflare", "cloudflare-workers-ai", "workers-ai", "cf"].includes(normalized)) {
    return "cloudflare";
  }
  if (["github-copilot", "copilot", "github_copilot", "githubcopilot"].includes(normalized)) {
    return "github-copilot";
  }
  if (["faux", "mock", "fake"].includes(normalized)) {
    return "faux";
  }
  return "openai";
}

/**
 * 补全 API URL 路径
 * 对应 Python: core/llm/adapters/adapter.py complete_api_url
 */
export function completeApiUrl(url: string, protocol: APIProtocol = "openai"): string {
  let base = url.trim();
  if (!base) return "";

  base = base.replace(/\/+$/, "");
  let path = "";
  try {
    path = new URL(base).pathname;
  } catch {
    path = "";
  }

  // 把"复用型"协议映射到其底层协议的 URL 规则：
  // - openai-codex 复用 Responses API 路径
  // - google-vertex 复用 Gemini 路径（原样返回，端点由调用方拼接）
  // - azure：完整 URL（deployments + api-version）由 client 单独构建，这里原样返回
  // - cloudflare / github-copilot：OpenAI 兼容路径（cloudflare 的占位符由 client 替换）
  const rawProtocol = normalizeApiProtocol(protocol);
  if (rawProtocol === "azure") return base;
  const protocolUrlAlias: Partial<Record<APIProtocol, APIProtocol>> = {
    "openai-codex": "responses",
    "google-vertex": "google",
    cloudflare: "openai",
    "github-copilot": "openai",
    faux: "openai",
  };
  const np = protocolUrlAlias[rawProtocol] ?? rawProtocol;

  if (np === "anthropic") {
    if (path.endsWith("/v1/messages")) return base;
    if (/\/v1$/.test(path)) return base + "/messages";
    if (!path.includes("/v1")) return base + "/v1/messages";
    return base;
  }

  if (np === "responses") {
    if (path.endsWith("/v1/responses")) return base;
    if (/\/v1$/.test(path)) return base + "/responses";
    if (!path.includes("/v1")) return base + "/v1/responses";
    return base;
  }

  if (np === "google") {
    // Google Gemini: https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}
    // 如果 URL 已经包含 /models/ 或 :generateContent，则原样返回
    if (path.includes("/models/") || path.includes(":generateContent") || path.includes(":streamGenerateContent")) {
      return base;
    }
    // 否则原样返回（model 和 method 由调用方在 URL 中指定）
    return base;
  }

  if (np === "mistral") {
    // Mistral: https://api.mistral.ai/v1/chat/completions
    if (path.includes("/chat")) return base;
    if (/\/v1$/.test(path)) return base + "/chat/completions";
    if (!path.includes("/v1")) return base + "/v1/chat/completions";
    return base;
  }

  if (np === "bedrock") {
    // AWS Bedrock: https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
    // URL 格式由 preset.url + preset.model 组合，这里只做路径补全
    if (path.includes("/converse") || path.includes("/converse-stream")) return base;
    if (path.includes("/model/")) {
      // 已包含 modelId，补全 converse 或 converse-stream
      // 注意：stream 参数由 LLMClient 在 body 中传递，Bedrock 通过端点区分
      // 这里默认补全 converse（非流式），流式由调用方在 URL 中指定 converse-stream
      return base + "/converse";
    }
    // 如果 URL 不包含 /model/，则原样返回（modelId 由 preset.model 提供，需要在 URL 中拼接）
    return base;
  }

  // openai
  if (path.includes("/chat")) return base;
  if (/\/v1$/.test(path)) return base + "/chat/completions";
  if (!path.includes("/v1")) return base + "/v1/chat/completions";
  return base;
}
