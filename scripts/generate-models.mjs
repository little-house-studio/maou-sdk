#!/usr/bin/env node
/**
 * generate-models.mjs —— 从 models.dev 拉取真实模型数据，生成 catalog
 *
 * 对标 pi-ai 的 generate-models.ts。models.dev 每 24h 由 GitHub Action 从各厂商刷新，
 * 覆盖 144+ 厂商、全量模型 + 实时定价 + 能力。
 *
 * 用法（需联网）:
 *   node scripts/generate-models.mjs                 # 全量生成 → core/llm/src/registry/catalog.generated.ts
 *   node scripts/generate-models.mjs --providers anthropic,openai,google  # 只生成指定厂商
 *
 * 生成后：catalog.ts 可改为 import 生成的数据，或合并手写 + 生成。
 * 手写 catalog 保留作为离线兜底（生成失败时）。
 */

import { writeFileSync } from "node:fs";

const API = "https://models.dev/api.json";

// models.dev provider id → 我们的 protocol + baseUrl 映射
// （models.dev 不提供 baseUrl/protocol，需我们补；未列出的 provider 默认走 openai 协议）
const PROVIDER_META = {
  openai: { protocol: "openai", baseUrl: "https://api.openai.com/v1", envKey: "OPENAI_API_KEY" },
  anthropic: { protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1/messages", envKey: "ANTHROPIC_API_KEY" },
  google: { protocol: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta", envKey: "GEMINI_API_KEY" },
  "google-vertex": { protocol: "google-vertex", baseUrl: "https://aiplatform.googleapis.com", envKey: "GOOGLE_VERTEX_API_KEY" },
  mistral: { protocol: "mistral", baseUrl: "https://api.mistral.ai/v1/chat/completions", envKey: "MISTRAL_API_KEY" },
  "amazon-bedrock": { protocol: "bedrock", baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", envKey: "AWS_BEARER_TOKEN_BEDROCK" },
  groq: { protocol: "openai", baseUrl: "https://api.groq.com/openai/v1/chat/completions", envKey: "GROQ_API_KEY" },
  xai: { protocol: "openai", baseUrl: "https://api.x.ai/v1/chat/completions", envKey: "XAI_API_KEY" },
  deepseek: { protocol: "openai", baseUrl: "https://api.deepseek.com/v1/chat/completions", envKey: "DEEPSEEK_API_KEY" },
  openrouter: { protocol: "openai", baseUrl: "https://openrouter.ai/api/v1/chat/completions", envKey: "OPENROUTER_API_KEY" },
  "github-copilot": { protocol: "github-copilot", baseUrl: "https://api.githubcopilot.com/chat/completions" },
  cerebras: { protocol: "openai", baseUrl: "https://api.cerebras.ai/v1/chat/completions", envKey: "CEREBRAS_API_KEY" },
  together: { protocol: "openai", baseUrl: "https://api.together.xyz/v1/chat/completions", envKey: "TOGETHER_API_KEY" },
  fireworks: { protocol: "openai", baseUrl: "https://api.fireworks.ai/inference/v1/chat/completions", envKey: "FIREWORKS_API_KEY" },
  moonshotai: { protocol: "openai", baseUrl: "https://api.moonshot.ai/v1/chat/completions", envKey: "MOONSHOT_API_KEY" },
  zhipuai: { protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions", envKey: "ZHIPU_API_KEY" },
  minimax: { protocol: "openai", baseUrl: "https://api.minimax.io/v1/chat/completions", envKey: "MINIMAX_API_KEY" },
  nvidia: { protocol: "openai", baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions", envKey: "NVIDIA_API_KEY" },
  cloudflare: { protocol: "cloudflare", baseUrl: "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1", envKey: "CLOUDFLARE_API_KEY" },
};

function modalityMap(arr) {
  if (!arr) return [];
  return arr.filter((m) => ["text", "image", "audio", "pdf", "video"].includes(m));
}

function convertModel(providerId, modelId, m, meta) {
  const input = modalityMap(m.modalities?.input) ?? (m.attachment ? ["text", "image"] : ["text"]);
  return {
    id: m.id ?? modelId,
    provider: providerId,
    name: m.name ?? modelId,
    protocol: meta.protocol,
    baseUrl: meta.baseUrl,
    input,
    output: modalityMap(m.modalities?.output) ?? ["text"],
    reasoning: !!m.reasoning,
    toolCall: m.tool_call !== false,
    contextWindow: m.limit?.context,
    maxTokens: m.limit?.output,
    pricing: m.cost
      ? {
          input: Number(m.cost.input ?? 0),
          output: Number(m.cost.output ?? 0),
          cacheRead: m.cost.cache_read != null ? Number(m.cost.cache_read) : undefined,
          cacheWrite: m.cost.cache_write != null ? Number(m.cost.cache_write) : undefined,
          currency: "USD",
        }
      : undefined,
    knowledge: m.knowledge,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const onlyArg = argv.find((a) => a.startsWith("--providers"));
  const only = onlyArg ? onlyArg.split("=")[1]?.split(",") ?? onlyArg.split(",")[1]?.split(",") : null;

  console.log("Fetching models from models.dev API...");
  const res = await fetch(API);
  if (!res.ok) throw new Error(`models.dev 返回 ${res.status}`);
  const data = await res.json();

  const providers = Object.values(data).filter((p) => p && p.id && p.models);
  const target = only ? providers.filter((p) => only.includes(p.id)) : providers.filter((p) => PROVIDER_META[p.id]);
  console.log(`models.dev 共 ${providers.length} 厂商；生成 ${target.length} 个（有 protocol 映射的）`);

  const catalog = target.map((p) => {
    const meta = PROVIDER_META[p.id];
    const models = Object.entries(p.models)
      .filter(([, m]) => m.tool_call !== false) // 只保留支持工具调用的（对标 pi）
      .map(([mid, m]) => convertModel(p.id, mid, m, meta));
    return {
      id: p.id,
      name: p.name ?? p.id,
      protocol: meta.protocol,
      baseUrl: meta.baseUrl,
      envKey: meta.envKey,
      models,
    };
  });

  const total = catalog.reduce((s, p) => s + p.models.length, 0);
  const code = `// ⚠️ 自动生成（scripts/generate-models.mjs，数据源 models.dev/api.json）。
// 请勿手改——重新运行脚本即可更新。
// 生成时间：${new Date().toISOString().slice(0, 10)}
// 模型总数：${total}，厂商：${catalog.length}
import type { ProviderSpec } from "./types.js";
export const CATALOG_GENERATED: ProviderSpec[] = ${JSON.stringify(catalog, null, 2)} as const;
`;

  const out = "core/llm/src/registry/catalog.generated.ts";
  writeFileSync(out, code);
  console.log(`✅ 生成 ${total} 个模型 → ${out}`);
  console.log(`   厂商：${catalog.map((p) => p.id).join(", ")}`);
}

main().catch((e) => {
  console.error("生成失败:", e.message);
  process.exit(1);
});
