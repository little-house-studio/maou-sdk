/**
 * 扩展注册供应商 / 登录。
 * 运行时写入模型目录；可选持久化到 ~/.maou/extension-providers.json。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserMaouRoot } from "@little-house-studio/types";
import type { APIPreset, APIProtocol } from "./adapters/types.js";
import { registerProvider, unregisterProvider } from "./registry/index.js";
import type { InputModality, ModelSpec, ProviderSpec } from "./registry/types.js";
import { registerAdapter } from "./adapter-registry.js";
import type { ProtocolAdapter } from "./adapters/types.js";

export interface ExtensionProviderModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image" | "audio" | "pdf" | "video">;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}

export interface ExtensionOAuthCredentials {
  access: string;
  refresh?: string;
  expires?: number;
}

export interface ExtensionOAuthConfig {
  name: string;
  login: (interaction: {
    onAuth: (info: { url: string }) => void;
    onPrompt: (opts: { message: string; type?: "text" | "secret" }) => Promise<string>;
  }) => Promise<ExtensionOAuthCredentials>;
  refreshToken?: (
    credentials: ExtensionOAuthCredentials,
    signal?: AbortSignal,
  ) => Promise<ExtensionOAuthCredentials>;
  getApiKey: (credentials: ExtensionOAuthCredentials) => string;
}

export interface ExtensionProviderInput {
  name: string;
  displayName?: string;
  baseUrl: string;
  apiKey?: string;
  /** Pi 的 api 字段，如 openai-completions / anthropic-messages */
  api?: string;
  protocol?: APIProtocol;
  headers?: Record<string, string>;
  models: ExtensionProviderModel[];
  oauth?: ExtensionOAuthConfig;
  /** 自定义协议适配器（不落盘，仅运行时） */
  adapter?: ProtocolAdapter;
}

const oauthLogins = new Map<string, ExtensionOAuthConfig>();

/** 常见协议别名 → Maou APIProtocol */
export function mapPiApiToProtocol(api?: string, fallback?: APIProtocol): APIProtocol {
  const a = (api ?? "").trim().toLowerCase();
  if (a === "anthropic-messages" || a === "anthropic") return "anthropic";
  if (a === "openai-responses" || a === "responses") return "responses";
  if (a === "openai-codex-responses" || a === "openai-codex") return "openai-codex";
  if (a === "google" || a === "google-generative-ai") return "google";
  if (a === "google-vertex") return "google-vertex";
  if (a === "bedrock") return "bedrock";
  if (a === "azure") return "azure";
  if (a === "mistral") return "mistral";
  if (a === "github-copilot") return "github-copilot";
  if (a === "cloudflare") return "cloudflare";
  if (fallback) return fallback;
  return "openai";
}

export function extensionProvidersPath(root?: string): string {
  return join(root ?? resolveUserMaouRoot(), "extension-providers.json");
}

function atomicWrite(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, filePath);
}

export function extensionProviderToPresets(input: ExtensionProviderInput): APIPreset[] {
  const protocol = input.protocol ?? mapPiApiToProtocol(input.api);
  const models = input.models.length > 0 ? input.models : [{ id: input.name }];
  return models.map((m) => {
    const preset: APIPreset = {
      name: models.length > 1 ? `${input.name}/${m.name ?? m.id}` : input.name,
      model: m.id,
      url: input.baseUrl,
      protocol,
      key: input.apiKey ?? "",
      maxTokens: m.maxTokens ?? 8192,
      maxContext: m.contextWindow,
      supportsVision: Boolean(m.input?.includes("image")),
      supportsReasoning: Boolean(m.reasoning),
      nativeToolCalling: true,
    };
    if (input.headers) preset.extraHeaders = input.headers;
    if (m.cost) {
      (preset as Record<string, unknown>).pricing = {
        inputPrice: m.cost.input,
        outputPrice: m.cost.output,
        cacheHitPrice: m.cost.cacheRead ?? 0,
      };
    }
    return preset;
  });
}

function toProviderSpec(input: ExtensionProviderInput): ProviderSpec {
  const protocol = input.protocol ?? mapPiApiToProtocol(input.api);
  const models: ModelSpec[] = (input.models.length ? input.models : [{ id: input.name }]).map(
    (m) => ({
      id: m.id,
      provider: input.name,
      name: m.name ?? m.id,
      protocol,
      input: (m.input ?? ["text"]) as InputModality[],
      output: ["text"],
      reasoning: Boolean(m.reasoning),
      toolCall: true,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      pricing: m.cost
        ? {
            input: m.cost.input,
            output: m.cost.output,
            cacheRead: m.cost.cacheRead,
            cacheWrite: m.cost.cacheWrite,
          }
        : undefined,
    }),
  );
  return {
    id: input.name,
    name: input.displayName ?? input.name,
    protocol,
    baseUrl: input.baseUrl,
    models,
  };
}

export function registerExtensionProviderRuntime(input: ExtensionProviderInput): APIPreset[] {
  if (!input.name?.trim()) throw new Error("extension provider name required");
  if (!input.baseUrl?.trim()) throw new Error("extension provider baseUrl required");
  registerProvider(toProviderSpec(input));
  if (input.adapter) registerAdapter(input.adapter);
  if (input.oauth) oauthLogins.set(input.name, input.oauth);
  return extensionProviderToPresets(input);
}

export function unregisterExtensionProviderRuntime(name: string): void {
  unregisterProvider(name);
  oauthLogins.delete(name);
}

export function persistExtensionProviders(
  inputs: ExtensionProviderInput[],
  filePath?: string,
): string {
  const path = filePath ?? extensionProvidersPath();
  const serializable = inputs.map(({ oauth: _o, adapter: _a, ...rest }) => rest);
  atomicWrite(path, { providers: serializable });
  return path;
}

export function loadPersistedExtensionProviders(filePath?: string): ExtensionProviderInput[] {
  const path = filePath ?? extensionProvidersPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { providers?: ExtensionProviderInput[] };
    return Array.isArray(raw.providers) ? raw.providers : [];
  } catch {
    return [];
  }
}

export function loadPersistedExtensionPresets(filePath?: string): APIPreset[] {
  const out: APIPreset[] = [];
  for (const p of loadPersistedExtensionProviders(filePath)) {
    try {
      registerExtensionProviderRuntime(p);
      out.push(...extensionProviderToPresets(p));
    } catch {
      /* skip broken rows */
    }
  }
  return out;
}

export function upsertPersistedExtensionProvider(
  input: ExtensionProviderInput,
  filePath?: string,
): string {
  const path = filePath ?? extensionProvidersPath();
  const { oauth: _o, adapter: _a, ...rest } = input;
  const cur = loadPersistedExtensionProviders(path).filter((p) => p.name !== input.name);
  cur.push(rest);
  return persistExtensionProviders(cur, path);
}

export function removePersistedExtensionProvider(name: string, filePath?: string): void {
  const path = filePath ?? extensionProvidersPath();
  const cur = loadPersistedExtensionProviders(path).filter((p) => p.name !== name);
  persistExtensionProviders(cur, path);
}

function extOauthFile(name: string): string {
  const dir = process.env.MAOU_OAUTH_DIR ?? join(resolveUserMaouRoot(), "oauth");
  return join(dir, `ext-${name.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`);
}

export async function loginExtensionProvider(
  name: string,
  interaction: {
    onAuth: (info: { url: string }) => void;
    onPrompt: (opts: { message: string; type?: "text" | "secret" }) => Promise<string>;
  },
): Promise<{ key: string; credentials: ExtensionOAuthCredentials }> {
  const oauth = oauthLogins.get(name);
  if (!oauth) throw new Error(`provider ${name} 未注册 OAuth`);
  const credentials = await oauth.login(interaction);
  const key = oauth.getApiKey(credentials);
  const file = extOauthFile(name);
  mkdirSync(dirname(file), { recursive: true });
  atomicWrite(file, { provider: name, ...credentials, accessToken: credentials.access });
  return { key, credentials };
}

export function getExtensionOAuthLogin(name: string): ExtensionOAuthConfig | undefined {
  return oauthLogins.get(name);
}
