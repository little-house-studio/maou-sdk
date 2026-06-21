/**
 * 图片生成 SDK
 *
 * 对标 pi-ai：getImageProviders / getImageModels / getImageModel / generateImages。
 * 支持 OpenAI Images API（gpt-image-1 / dall-e-3 / dall-e-2）及任意 OpenAI 兼容
 * images/generations 端点。
 *
 * @example
 * const { images } = await generateImages({ model: "gpt-image-1", prompt: "一只赛博朋克猫" })
 * fs.writeFileSync("cat.png", Buffer.from(images[0].b64!, "base64"))
 */

import { readEnv } from "../runtime-env.js";

// ── 类型 ──

/** 图片模型规格 */
export interface ImageModelSpec {
  id: string;
  provider: string;
  name?: string;
  /** 支持的尺寸（如 "1024x1024"） */
  sizes?: string[];
  /** 每张图片价格（USD），可选 */
  pricePerImage?: number;
}

/** 图片 provider 规格 */
export interface ImageProviderSpec {
  id: string;
  name: string;
  /** images/generations 端点 */
  baseUrl: string;
  /** 读取 key 的环境变量 */
  envKey?: string;
  models: ImageModelSpec[];
}

/** 生成参数 */
export interface GenerateImagesParams {
  /** 模型 id（如 "gpt-image-1"） */
  model: string;
  /** 提示词 */
  prompt: string;
  /** 生成张数（默认 1） */
  n?: number;
  /** 尺寸（如 "1024x1024"） */
  size?: string;
  /** 质量（dall-e-3: "standard"|"hd"；gpt-image-1: "low"|"medium"|"high"|"auto"） */
  quality?: string;
  /** 显式 API key（覆盖环境变量） */
  apiKey?: string;
  /** 覆盖端点 */
  baseUrl?: string;
  /** provider id（默认 "openai"） */
  provider?: string;
  /** 中断信号 */
  signal?: AbortSignal;
}

/** 单张生成结果 */
export interface GeneratedImage {
  /** base64（不含 data: 前缀），多数情况下有值 */
  b64?: string;
  /** 图片 URL（部分模型/参数返回 URL 而非 base64） */
  url?: string;
  /** MIME 类型 */
  mimeType: string;
  /** 修订后的提示词（部分模型返回） */
  revisedPrompt?: string;
}

/** 生成总结果 */
export interface GenerateImagesResult {
  images: GeneratedImage[];
  model: string;
  /** 原始响应（调试用） */
  raw?: unknown;
}

// ── 图片模型目录 ──

const IMAGE_PROVIDERS = new Map<string, ImageProviderSpec>([
  [
    "openai",
    {
      id: "openai",
      name: "OpenAI Images",
      baseUrl: "https://api.openai.com/v1/images/generations",
      envKey: "OPENAI_API_KEY",
      models: [
        { id: "gpt-image-1", provider: "openai", name: "GPT Image 1", sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"] },
        { id: "dall-e-3", provider: "openai", name: "DALL·E 3", sizes: ["1024x1024", "1024x1792", "1792x1024"], pricePerImage: 0.04 },
        { id: "dall-e-2", provider: "openai", name: "DALL·E 2", sizes: ["256x256", "512x512", "1024x1024"], pricePerImage: 0.02 },
      ],
    },
  ],
  [
    "openrouter",
    {
      id: "openrouter",
      name: "OpenRouter Images",
      baseUrl: "https://openrouter.ai/api/v1/images/generations",
      envKey: "OPENROUTER_API_KEY",
      models: [
        { id: "google/gemini-2.5-flash-image-preview", provider: "openrouter", name: "Gemini 2.5 Flash Image" },
      ],
    },
  ],
]);

// ── 查询 ──

export function getImageProviders(): ImageProviderSpec[] {
  return [...IMAGE_PROVIDERS.values()];
}

export function getImageModels(provider: string): ImageModelSpec[] {
  return IMAGE_PROVIDERS.get(provider)?.models ?? [];
}

export function getImageModel(provider: string, id: string): ImageModelSpec | null {
  return IMAGE_PROVIDERS.get(provider)?.models.find((m) => m.id === id) ?? null;
}

/** 注册/覆盖图片 provider */
export function registerImageProvider(spec: ImageProviderSpec): void {
  IMAGE_PROVIDERS.set(spec.id, spec);
}

// ── 生成 ──

/**
 * 调用 images/generations 端点生成图片。
 */
export async function generateImages(params: GenerateImagesParams): Promise<GenerateImagesResult> {
  const providerId = params.provider ?? "openai";
  const provider = IMAGE_PROVIDERS.get(providerId);
  const baseUrl = params.baseUrl ?? provider?.baseUrl;
  if (!baseUrl) throw new Error(`未知图片 provider: ${providerId}（且未提供 baseUrl）`);

  const apiKey = params.apiKey ?? (provider?.envKey ? readEnv(provider.envKey) : undefined);
  if (!apiKey) {
    throw new Error(`缺少 API key（设置 ${provider?.envKey ?? "对应环境变量"} 或传入 apiKey）`);
  }

  const isGptImage = params.model.startsWith("gpt-image");
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: params.n ?? 1,
  };
  if (params.size) body.size = params.size;
  if (params.quality) body.quality = params.quality;
  // gpt-image-1 固定返回 b64_json，不接受 response_format；其余模型显式要 b64_json
  if (!isGptImage) body.response_format = "b64_json";

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`图片生成失败 (${response.status}): ${detail.slice(0, 500)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const items = Array.isArray(data.data) ? (data.data as Record<string, unknown>[]) : [];
  const images: GeneratedImage[] = items.map((item) => ({
    b64: typeof item.b64_json === "string" ? item.b64_json : undefined,
    url: typeof item.url === "string" ? item.url : undefined,
    mimeType: "image/png",
    revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
  }));

  return { images, model: params.model, raw: data };
}
