/**
 * 环境变量 API Key 检测
 *
 * 对标 pi-ai 的 getEnvApiKey / findEnvKeys：覆盖 30+ 主流厂商的常见环境变量名，
 * 自动发现已配置的 key，省去手填。读取统一走 runtime-env（兼容 Bun / 浏览器）。
 */

import { readEnv } from "./runtime-env.js";

/** provider id → 候选环境变量名（按优先级，先命中先用） */
export const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  "google-vertex": ["GOOGLE_VERTEX_API_KEY", "GCP_ACCESS_TOKEN"],
  azure: ["AZURE_OPENAI_API_KEY", "AZURE_API_KEY"],
  "openai-codex": ["OPENAI_CODEX_API_KEY"],
  "github-copilot": ["GITHUB_COPILOT_TOKEN", "COPILOT_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY", "GROK_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  cloudflare: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_API_TOKEN"],
  together: ["TOGETHER_API_KEY", "TOGETHERAI_API_KEY"],
  deepinfra: ["DEEPINFRA_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  nvidia: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY", "PPLX_API_KEY"],
  cohere: ["COHERE_API_KEY", "CO_API_KEY"],
  ai21: ["AI21_API_KEY"],
  moonshot: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  zhipu: ["ZHIPU_API_KEY", "ZHIPUAI_API_KEY", "GLM_API_KEY"],
  qwen: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
  baichuan: ["BAICHUAN_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  hunyuan: ["HUNYUAN_API_KEY"],
  spark: ["SPARK_API_KEY", "IFLYTEK_API_KEY"],
  ernie: ["ERNIE_API_KEY", "QIANFAN_API_KEY", "BAIDU_API_KEY"],
  yi: ["YI_API_KEY", "LINGYIWANWU_API_KEY"],
  step: ["STEP_API_KEY", "STEPFUN_API_KEY"],
  gitee: ["GITEE_API_KEY"],
  bedrock: ["AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID"],
  vercel: ["AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_KEY"],
  zai: ["ZAI_API_KEY", "Z_API_KEY"],
  ollama: [], // 本地，无需 key
};

/**
 * 取某个 provider 的 API key（按候选顺序检索环境变量），未命中返回 undefined。
 */
export function getEnvApiKey(provider: string): string | undefined {
  const candidates = PROVIDER_ENV_KEYS[provider];
  if (candidates) {
    for (const env of candidates) {
      const v = readEnv(env);
      if (v && v.trim()) return v.trim();
    }
    return undefined;
  }
  // 未知 provider：尝试约定式 {PROVIDER}_API_KEY
  const guess = readEnv(`${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`);
  return guess && guess.trim() ? guess.trim() : undefined;
}

/**
 * 扫描所有已知 provider，返回当前环境中已配置 key 的 provider 列表。
 */
export function findEnvKeys(): Array<{ provider: string; envVar: string }> {
  const found: Array<{ provider: string; envVar: string }> = [];
  for (const [provider, candidates] of Object.entries(PROVIDER_ENV_KEYS)) {
    for (const env of candidates) {
      const v = readEnv(env);
      if (v && v.trim()) {
        found.push({ provider, envVar: env });
        break;
      }
    }
  }
  return found;
}

/** 是否已为某 provider 配置了环境变量 key */
export function hasEnvKey(provider: string): boolean {
  return getEnvApiKey(provider) !== undefined;
}
