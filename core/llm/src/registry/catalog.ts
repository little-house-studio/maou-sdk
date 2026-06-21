/**
 * 内置模型目录（seed catalog）
 *
 * ⚠️ 定价为撰写时（约 2026-01）各厂商公开价的"指示值"，单位：USD / 每百万 token。
 *    价格会变动，请以厂商官网为准；可用 registerModel/registerProvider 覆盖或补充。
 *    CNY 计费的国产模型（qwen/zhipu/moonshot 等）暂不内置 pricing，避免混币种误算。
 *
 * 目录只是"种子"，不追求穷尽所有模型——通过 registerProvider/registerModel 可任意扩展。
 */

import type { ProviderSpec } from "./types.js";

export const CATALOG = [
  // ── OpenAI ──
  {
    id: "openai",
    name: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    envKey: "OPENAI_API_KEY",
    models: [
      {
        id: "gpt-4o", provider: "openai", name: "GPT-4o", protocol: "openai",
        input: ["text", "image", "audio"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 128_000, maxTokens: 16_384, knowledge: "2023-10",
        pricing: { input: 2.5, output: 10, cacheRead: 1.25 },
      },
      {
        id: "gpt-4o-mini", provider: "openai", name: "GPT-4o mini", protocol: "openai",
        input: ["text", "image"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 128_000, maxTokens: 16_384, knowledge: "2023-10",
        pricing: { input: 0.15, output: 0.6, cacheRead: 0.075 },
      },
      {
        id: "gpt-4.1", provider: "openai", name: "GPT-4.1", protocol: "openai",
        input: ["text", "image"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 1_000_000, maxTokens: 32_768, knowledge: "2024-06",
        pricing: { input: 2, output: 8, cacheRead: 0.5 },
      },
      {
        id: "gpt-4.1-mini", provider: "openai", name: "GPT-4.1 mini", protocol: "openai",
        input: ["text", "image"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 1_000_000, maxTokens: 32_768, knowledge: "2024-06",
        pricing: { input: 0.4, output: 1.6, cacheRead: 0.1 },
      },
      {
        id: "o3", provider: "openai", name: "o3", protocol: "responses",
        baseUrl: "https://api.openai.com/v1/responses",
        input: ["text", "image"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 200_000, maxTokens: 100_000, knowledge: "2024-06",
        pricing: { input: 2, output: 8, cacheRead: 0.5 },
      },
      {
        id: "o4-mini", provider: "openai", name: "o4-mini", protocol: "responses",
        baseUrl: "https://api.openai.com/v1/responses",
        input: ["text", "image"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 200_000, maxTokens: 100_000, knowledge: "2024-06",
        pricing: { input: 1.1, output: 4.4, cacheRead: 0.275 },
      },
    ],
  },

  // ── Anthropic ──
  {
    id: "anthropic",
    name: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1/messages",
    envKey: "ANTHROPIC_API_KEY",
    models: [
      {
        id: "claude-opus-4-1", provider: "anthropic", name: "Claude Opus 4.1", protocol: "anthropic",
        input: ["text", "image", "pdf"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 200_000, maxTokens: 32_000, knowledge: "2025-03",
        pricing: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
      },
      {
        id: "claude-sonnet-4-5", provider: "anthropic", name: "Claude Sonnet 4.5", protocol: "anthropic",
        input: ["text", "image", "pdf"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 200_000, maxTokens: 64_000, knowledge: "2025-03",
        pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      {
        id: "claude-3-5-sonnet-latest", provider: "anthropic", name: "Claude 3.5 Sonnet", protocol: "anthropic",
        input: ["text", "image", "pdf"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 200_000, maxTokens: 8_192, knowledge: "2024-04",
        pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      {
        id: "claude-3-5-haiku-latest", provider: "anthropic", name: "Claude 3.5 Haiku", protocol: "anthropic",
        input: ["text", "image"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 200_000, maxTokens: 8_192, knowledge: "2024-07",
        pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
      },
    ],
  },

  // ── Google Gemini ──
  {
    id: "google",
    name: "Google Gemini",
    protocol: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envKey: "GEMINI_API_KEY",
    models: [
      {
        id: "gemini-2.5-pro", provider: "google", name: "Gemini 2.5 Pro", protocol: "google",
        input: ["text", "image", "audio", "pdf", "video"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 1_048_576, maxTokens: 65_536, knowledge: "2025-01",
        pricing: { input: 1.25, output: 10 },
      },
      {
        id: "gemini-2.5-flash", provider: "google", name: "Gemini 2.5 Flash", protocol: "google",
        input: ["text", "image", "audio", "pdf", "video"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 1_048_576, maxTokens: 65_536, knowledge: "2025-01",
        pricing: { input: 0.3, output: 2.5 },
      },
      {
        id: "gemini-2.0-flash", provider: "google", name: "Gemini 2.0 Flash", protocol: "google",
        input: ["text", "image", "audio", "pdf", "video"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 1_048_576, maxTokens: 8_192, knowledge: "2024-08",
        pricing: { input: 0.1, output: 0.4 },
      },
    ],
  },

  // ── DeepSeek ──
  {
    id: "deepseek",
    name: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    envKey: "DEEPSEEK_API_KEY",
    models: [
      {
        id: "deepseek-chat", provider: "deepseek", name: "DeepSeek-V3", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 65_536, maxTokens: 8_192, knowledge: "2024-07",
        pricing: { input: 0.27, output: 1.1, cacheRead: 0.07 },
      },
      {
        id: "deepseek-reasoner", provider: "deepseek", name: "DeepSeek-R1", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 65_536, maxTokens: 8_192, knowledge: "2024-07",
        pricing: { input: 0.55, output: 2.19, cacheRead: 0.14 },
      },
    ],
  },

  // ── Mistral ──
  {
    id: "mistral",
    name: "Mistral AI",
    protocol: "mistral",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    envKey: "MISTRAL_API_KEY",
    models: [
      {
        id: "mistral-large-latest", provider: "mistral", name: "Mistral Large", protocol: "mistral",
        input: ["text"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 131_072, maxTokens: 8_192, knowledge: "2024-07",
        pricing: { input: 2, output: 6 },
      },
      {
        id: "mistral-small-latest", provider: "mistral", name: "Mistral Small", protocol: "mistral",
        input: ["text", "image"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 131_072, maxTokens: 8_192, knowledge: "2024-07",
        pricing: { input: 0.2, output: 0.6 },
      },
    ],
  },

  // ── Groq（OpenAI 兼容，超快推理）──
  {
    id: "groq",
    name: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    envKey: "GROQ_API_KEY",
    models: [
      {
        id: "llama-3.3-70b-versatile", provider: "groq", name: "Llama 3.3 70B", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 131_072, maxTokens: 32_768, knowledge: "2023-12",
        pricing: { input: 0.59, output: 0.79 },
      },
    ],
  },

  // ── xAI Grok（OpenAI 兼容）──
  {
    id: "xai",
    name: "xAI",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1/chat/completions",
    envKey: "XAI_API_KEY",
    models: [
      {
        id: "grok-2-latest", provider: "xai", name: "Grok 2", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 131_072, maxTokens: 8_192, knowledge: "2024-07",
        pricing: { input: 2, output: 10 },
      },
    ],
  },

  // ── OpenRouter（聚合网关，model 形如 "vendor/model"）──
  {
    id: "openrouter",
    name: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    envKey: "OPENROUTER_API_KEY",
    models: [
      {
        id: "anthropic/claude-sonnet-4.5", provider: "openrouter", name: "Claude Sonnet 4.5 (OR)", protocol: "openai",
        input: ["text", "image"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 200_000, maxTokens: 64_000,
        pricing: { input: 3, output: 15 },
      },
    ],
  },

  // ── 国产（CNY 计费，暂不内置 pricing）──
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1/chat/completions",
    envKey: "MOONSHOT_API_KEY",
    models: [
      {
        id: "kimi-k2-0905-preview", provider: "moonshot", name: "Kimi K2", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 262_144, maxTokens: 16_384,
      },
    ],
  },
  {
    id: "zhipu",
    name: "Zhipu GLM",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    envKey: "ZHIPU_API_KEY",
    models: [
      {
        id: "glm-4.5", provider: "zhipu", name: "GLM-4.5", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: true, toolCall: true,
        contextWindow: 131_072, maxTokens: 16_384,
      },
    ],
  },
  {
    id: "qwen",
    name: "Qwen / DashScope",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    envKey: "DASHSCOPE_API_KEY",
    models: [
      {
        id: "qwen-max", provider: "qwen", name: "Qwen Max", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 131_072, maxTokens: 8_192,
      },
    ],
  },

  // ── 本地（Ollama，OpenAI 兼容，无需 key / 免费）──
  {
    id: "ollama",
    name: "Ollama (local)",
    protocol: "openai",
    baseUrl: "http://localhost:11434/v1/chat/completions",
    models: [
      {
        id: "llama3.3", provider: "ollama", name: "Llama 3.3 (local)", protocol: "openai",
        input: ["text"], output: ["text"], reasoning: false, toolCall: true,
        contextWindow: 131_072,
      },
    ],
  },

  // ── 国产厂商（OpenAI 兼容端点，手写补充；models.dev 未收录 tool-capable 项）
  //   均走 protocol:"openai"，定价多为 CNY 故不内置（避免混币种）；contextWindow 为公开值。
  //   百度文心（千帆 v2 OpenAI 兼容）
  {
    id: "ernie",
    name: "百度文心 (ERNIE/Qianfan)",
    protocol: "openai",
    baseUrl: "https://qianfan.baidubce.com/v2/chat/completions",
    envKey: "ERNIE_API_KEY",
    models: [
      { id: "ernie-4.0-8k-latest", provider: "ernie", name: "ERNIE 4.0", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 8_192 },
      { id: "ernie-4.5-turbo-128k", provider: "ernie", name: "ERNIE 4.5 Turbo", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 128_000 },
      { id: "ernie-speed-128k", provider: "ernie", name: "ERNIE Speed 128k", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 128_000 },
      { id: "deepseek-r1-ernie", provider: "ernie", name: "DeepSeek-R1 (千帆)", protocol: "openai", input: ["text"], output: ["text"], reasoning: true, toolCall: true, contextWindow: 64_000 },
    ],
  },
  //   讯飞星火（spark-api-open OpenAI 兼容）
  {
    id: "spark",
    name: "讯飞星火 (iFlytek Spark)",
    protocol: "openai",
    baseUrl: "https://spark-api-open.xf-yun.com/v1/chat/completions",
    envKey: "SPARK_API_KEY",
    models: [
      { id: "4.0Ultra", provider: "spark", name: "Spark 4.0 Ultra", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 8_192 },
      { id: "generalv3.5", provider: "spark", name: "Spark 3.5", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 8_192 },
      { id: "general-r1", provider: "spark", name: "Spark R1 (推理)", protocol: "openai", input: ["text"], output: ["text"], reasoning: true, toolCall: true, contextWindow: 64_000 },
    ],
  },
  //   字节豆包（火山方舟 Ark，OpenAI 兼容；model 用 ep- 开头的 endpoint id）
  {
    id: "doubao",
    name: "字节豆包 (Doubao/Volcengine Ark)",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    envKey: "ARK_API_KEY",
    models: [
      { id: "doubao-pro-32k", provider: "doubao", name: "Doubao Pro 32k", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 32_768 },
      { id: "doubao-pro-128k", provider: "doubao", name: "Doubao Pro 128k", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 128_000 },
      { id: "doubao-1-5-thinking-pro", provider: "doubao", name: "Doubao 1.5 Thinking", protocol: "openai", input: ["text"], output: ["text"], reasoning: true, toolCall: true, contextWindow: 128_000 },
      { id: "deepseek-r1-ark", provider: "doubao", name: "DeepSeek-R1 (Ark)", protocol: "openai", input: ["text"], output: ["text"], reasoning: true, toolCall: true, contextWindow: 64_000 },
    ],
  },
  //   腾讯混元（OpenAI 兼容）
  {
    id: "hunyuan",
    name: "腾讯混元 (Hunyuan)",
    protocol: "openai",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
    envKey: "HUNYUAN_API_KEY",
    models: [
      { id: "hunyuan-turbos-latest", provider: "hunyuan", name: "Hunyuan Turbos", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 32_768 },
      { id: "hunyuan-standard", provider: "hunyuan", name: "Hunyuan Standard", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 32_768 },
      { id: "hunyuan-t1", provider: "hunyuan", name: "Hunyuan T1 (推理)", protocol: "openai", input: ["text"], output: ["text"], reasoning: true, toolCall: true, contextWindow: 64_000 },
    ],
  },
  //   360 智脑（OpenAI 兼容）
  {
    id: "qihoo-360",
    name: "360 智脑",
    protocol: "openai",
    baseUrl: "https://api.360.cn/v1/chat/completions",
    envKey: "AI360_API_KEY",
    models: [
      { id: "360gpt2-pro", provider: "qihoo-360", name: "360GPT2 Pro", protocol: "openai", input: ["text"], output: ["text"], reasoning: false, toolCall: true, contextWindow: 8_192 },
    ],
  },
] as const satisfies ProviderSpec[];
