/**
 * URL 构建器 —— Bedrock / Azure / Vertex 三个协议的请求 URL 拼接
 *
 * 从 client.ts 拆出（原 _buildBedrockUrl / _buildAzureUrl / _buildVertexUrl 三个 private 方法）。
 * 这三个协议的 URL 规则比 OpenAI 系复杂（含 modelId / deployment / api-version / region），
 * client._buildRequest 根据 protocol 分发到这里。其余协议走 completeApiUrl（adapters/types.ts）。
 *
 * 都是纯函数（接 preset，无 this 依赖）。
 * Azure 的 resolveAzureDeployment / resolveAzureApiVersion 已在 azure-openai.ts，这里复用。
 */

import type { APIPreset } from "./adapters/types.js";
import { resolveAzureDeployment, resolveAzureApiVersion } from "./adapters/azure-openai.js";

/**
 * 构建 Bedrock 请求 URL
 * Bedrock 端点格式：
 *   非流式：{base}/model/{modelId}/converse
 *   流式：  {base}/model/{modelId}/converse-stream
 */
export function buildBedrockUrl(preset: APIPreset, stream: boolean): string {
  const baseUrl = String(preset.url ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) return "";

  const modelId = String(preset.model ?? "").trim();
  const endpoint = stream ? "converse-stream" : "converse";

  // 检查 URL 是否已包含完整路径
  try {
    const parsed = new URL(baseUrl);
    const path = parsed.pathname;
    // 如果 URL 已包含 /converse 或 /converse-stream，替换端点
    if (path.includes("/converse-stream")) {
      return stream ? baseUrl : baseUrl.replace("/converse-stream", "/converse");
    }
    if (path.includes("/converse")) {
      return stream ? baseUrl.replace("/converse", "/converse-stream") : baseUrl;
    }
    // 如果 URL 已包含 /model/{modelId}，只追加端点
    if (path.includes("/model/")) {
      return baseUrl + "/" + endpoint;
    }
  } catch {
    // URL 解析失败，按字符串拼接
  }

  // 默认拼接：{base}/model/{modelId}/{endpoint}
  if (modelId) {
    return `${baseUrl}/model/${encodeURIComponent(modelId)}/${endpoint}`;
  }
  return `${baseUrl}/${endpoint}`;
}

/**
 * 构建 Azure OpenAI 请求 URL
 * Azure 端点格式：
 *   {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}
 * deployment 取 preset.deployment（默认回退 preset.model），api-version 取 preset.api_version。
 */
export function buildAzureUrl(preset: APIPreset): string {
  const raw = String(preset.url ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";

  // 已是完整 URL（含 /deployments/ 且带 chat/completions）则原样返回（补全 api-version）
  const apiVersion = resolveAzureApiVersion(preset);
  if (raw.includes("/deployments/") && raw.includes("/chat/completions")) {
    return raw.includes("api-version=")
      ? raw
      : `${raw}${raw.includes("?") ? "&" : "?"}api-version=${apiVersion}`;
  }

  // 从 base endpoint 拼接完整路径
  let base = raw;
  try {
    const parsed = new URL(raw);
    base = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // 解析失败按字符串处理
  }
  const deployment = encodeURIComponent(resolveAzureDeployment(preset));
  return `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

/**
 * 构建 Google Vertex AI 请求 URL
 * Vertex 端点格式：
 *   https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}
 *     /publishers/google/models/{model}:{generateContent|streamGenerateContent}
 * project 取 preset.project，location 取 preset.location（默认 us-central1）。
 * 若 preset.url 已是完整端点（含 publishers/google/models 或 :generateContent），则按 stream 切换方法后返回。
 */
export function buildVertexUrl(preset: APIPreset, stream: boolean): string {
  const method = stream ? "streamGenerateContent" : "generateContent";
  const raw = String(preset.url ?? "").trim().replace(/\/+$/, "");

  // 已是完整端点：切换 generate/stream 方法（保留可能的 ?alt=sse）
  if (raw && (raw.includes(":generateContent") || raw.includes(":streamGenerateContent"))) {
    return raw.replace(/:(?:stream)?generateContent/i, `:${method}`);
  }
  if (raw && raw.includes("/publishers/google/models/")) {
    return `${raw}:${method}`;
  }

  const project = String(preset.project ?? preset.gcp_project ?? "").trim();
  const location = String(preset.location ?? preset.region ?? "us-central1").trim();
  const model = String(preset.model ?? "").trim();
  if (!project || !model) {
    // 信息不足，回退到原始 url（让厂商报清晰错误）
    return raw;
  }
  const host = `https://${location}-aiplatform.googleapis.com`;
  const path = `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:${method}`;
  return `${host}${path}`;
}
