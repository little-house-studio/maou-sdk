/**
 * 账户能力查询 —— 余额/额度 + 跨协议模型列表扫描
 *
 * 余额查询是 best-effort：并非所有厂商都开放余额 API（OpenAI/Anthropic 无标准余额端点），
 * 仅国产/部分云厂商提供（DeepSeek/Qwen/Zhipu/Moonshot 等）。未支持的厂商返回 unsupported。
 *
 * 模型扫描按协议分流：OpenAI 兼容走 /v1/models、Google 走 ListModels、
 * Anthropic 无列表 API 走 registry 静态兜底。
 */

import type { APIPreset } from "./adapters/types.js";

/** 余额查询结果 */
export interface BalanceResult {
  /** 是否支持余额查询（false = 厂商无此 API） */
  supported: boolean;
  /** 剩余余额（货币单位见 currency） */
  balance?: number;
  /** 货币（USD / CNY） */
  currency?: string;
  /** 已用量 */
  used?: number;
  /** 原始响应（调试用） */
  raw?: unknown;
  /** 不支持时的说明 */
  reason?: string;
}

/** 各厂商余额端点（best-effort，按 baseUrl 关键词匹配） */
const BALANCE_ENDPOINTS: Array<{ match: RegExp; url: string; currency: string; extract: (d: any) => { balance?: number; used?: number } }> = [
  {
    match: /deepseek/i,
    url: "https://api.deepseek.com/user/balance",
    currency: "CNY",
    extract: (d) => ({ balance: d?.balance_infos?.[0]?.total_balance != null ? Number(d.balance_infos[0].total_balance) / 1e4 : undefined }),
  },
  {
    match: /dashscope|qwen/i,
    url: "https://dashscope.aliyuncs.com/api/v1/usage",
    currency: "CNY",
    extract: (d) => ({ used: d?.data?.usage != null ? Number(d.data.usage) : undefined }),
  },
  {
    match: /bigmodel|zhipu/i,
    url: "https://open.bigmodel.cn/api/paas/v4/billing/subscription",
    currency: "CNY",
    extract: (d) => ({ balance: d?.balance != null ? Number(d.balance) : undefined }),
  },
  {
    match: /moonshot/i,
    url: "https://api.moonshot.cn/v1/users/me/balance",
    currency: "CNY",
    extract: (d) => ({ balance: d?.available_balance != null ? Number(d.available_balance) : undefined, used: d?.balance != null ? Number(d.balance) : undefined }),
  },
  {
    match: /minimax/i,
    url: "https://api.minimax.io/v1/billing/balance",
    currency: "USD",
    extract: (d) => ({ balance: d?.balance != null ? Number(d.balance) : undefined }),
  },
];

/**
 * 查询账户余额（best-effort）。未支持的厂商返回 { supported: false }。
 */
export async function queryBalance(preset: APIPreset, signal?: AbortSignal): Promise<BalanceResult> {
  const url = preset.url ?? "";
  const ep = BALANCE_ENDPOINTS.find((e) => e.match.test(url));
  if (!ep) {
    return { supported: false, reason: "该厂商未开放余额查询 API（OpenAI/Anthropic/Google 等无标准端点）" };
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (preset.key) headers["Authorization"] = `Bearer ${preset.key}`;
    const res = await fetch(ep.url, { headers, signal: signal ?? AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return { supported: true, reason: `余额查询失败 (${res.status})` };
    }
    const data = await res.json() as Record<string, unknown>;
    const extracted = ep.extract(data);
    return { supported: true, currency: ep.currency, ...extracted, raw: data };
  } catch (err) {
    return { supported: true, reason: `余额查询出错: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 模型扫描结果项 */
export interface ScannedModel {
  id: string;
  ownedBy?: string;
  contextWindow?: number;
}

/**
 * 跨协议扫描可用模型列表。
 * - OpenAI 兼容 / Responses / Azure / Cloudflare / Codex / Copilot → /v1/models
 * - Google / Vertex → ListModels
 * - Anthropic / Mistral / Bedrock → 无列表 API，返回 unsupported（用 registry 兜底）
 */
export async function scanModels(preset: APIPreset, signal?: AbortSignal): Promise<{ supported: boolean; models: ScannedModel[]; reason?: string }> {
  const url = preset.url ?? "";
  const proto = (preset.protocol ?? "openai").toLowerCase();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (preset.key) headers["Authorization"] = `Bearer ${preset.key}`;

  // Google：ListModels
  if (proto === "google" || proto === "google-vertex") {
    const keyParam = proto === "google" ? `?key=${encodeURIComponent(preset.key ?? "")}` : "";
    try {
      const base = url.replace(/\/models.*/, "") || "https://generativelanguage.googleapis.com/v1beta";
      const res = await fetch(`${base}/models${keyParam}`, { headers: proto === "google-vertex" ? headers : {}, signal: signal ?? AbortSignal.timeout(15_000) });
      if (!res.ok) return { supported: true, models: [], reason: `Google ListModels 失败 (${res.status})` };
      const data = await res.json() as Record<string, unknown>;
      const models = ((data.models as Array<Record<string, unknown>>) ?? []).map((m) => ({
        id: String(m.name ?? "").replace(/^models\//, ""),
        contextWindow: m.inputTokenLimit != null ? Number(m.inputTokenLimit) : undefined,
      }));
      return { supported: true, models };
    } catch (err) {
      return { supported: true, models: [], reason: String(err) };
    }
  }

  // OpenAI 兼容：/v1/models
  const openaiProtos = ["openai", "responses", "azure", "cloudflare", "openai-codex", "github-copilot"];
  if (openaiProtos.includes(proto)) {
    const baseUrl = url.replace(/\/chat\/completions$/, "").replace(/\/v1\/(messages|responses)$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
    try {
      const res = await fetch(`${baseUrl}/v1/models`, { headers, signal: signal ?? AbortSignal.timeout(15_000) });
      if (!res.ok) return { supported: true, models: [], reason: `/v1/models 失败 (${res.status})` };
      const data = await res.json() as Record<string, unknown>;
      const list = (data.data ?? data.models ?? []) as any[];
      const models = list.map((m) => ({ id: String(m.id ?? m.name ?? ""), ownedBy: String(m.owned_by ?? "") || undefined }));
      return { supported: true, models };
    } catch (err) {
      return { supported: true, models: [], reason: String(err) };
    }
  }

  // Anthropic/Mistral/Bedrock：无列表 API
  return { supported: false, models: [], reason: "该协议无模型列表 API，请用 registry 内置目录" };
}
