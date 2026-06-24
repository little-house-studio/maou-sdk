/**
 * LLMConfig —— 统一的 LLM 配置管理器
 *
 * 纯动态配置，无硬编码：
 *   ① 配置文件持久化（默认 ~/.maou/llm-config.json）
 *   ② 运行时注册（重启丢失）
 *   ③ 种子数据（可选，通过 loadSeed() 从外部注入）
 *
 * 设计目标：所有厂商和模型配置都从文件或运行时注册获取，
 * 不依赖内置硬编码目录。
 *
 * @example
 * // 默认：自动从 ~/.maou/llm-config.json 加载
 * const config = new LLMConfig();
 *
 * // 添加自定义厂商（持久化）
 * config.addCustomProvider({
 *   id: "my-api",
 *   name: "My API",
 *   protocol: "openai",
 *   baseUrl: "https://my-api.com/v1/chat/completions",
 *   envKey: "MY_API_KEY",
 *   models: [
 *     { id: "v1", name: "V1", contextWindow: 128_000, maxTokens: 8_192 },
 *   ],
 * });
 * await config.save();
 *
 * // 添加单模型配置（持久化）
 * config.addCustom({ name: "my-model", provider: "my-api", model: "v1", url: "..." });
 * await config.save();
 *
 * // 运行时注册（不持久化）
 * config.registerProvider({ id: "temp", name: "Temp", ... });
 *
 * // 查询
 * config.listProviders();  // 所有厂商（文件 + 运行时）
 * config.listModels("my-api");
 * config.toAPIPreset("my-model");
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  getProviders as registryGetProviders,
  getModels as registryGetModels,
  getModel as registryGetModel,
  registerProvider as registryRegisterProvider,
  registerModel as registryRegisterModel,
  toAPIPreset as registryToAPIPreset,
  type ModelSpec,
  type ProviderSpec,
} from "./registry/index.js";
import { getEnvApiKey } from "./env.js";
import { normalizeApiProtocol, completeApiUrl, type APIPreset, type APIProtocol } from "./adapters/types.js";

/** 默认配置文件路径（~/.maou/llm-config.json） */
export const DEFAULT_CONFIG_PATH = join(homedir(), ".maou", "llm-config.json");

/** 自定义模型配置（用户层面向配置文件的形态） */
export interface CustomPreset {
  /** 唯一名（用于查询/toAPIPreset） */
  name: string;
  /** 关联的 provider（可选；缺省时从 protocol 推断或视为独立） */
  provider?: string;
  model: string;
  url: string;
  protocol?: string;
  key?: string;
  maxTokens?: number;
  maxContext?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  nativeToolCalling?: boolean;
  /** 覆盖默认定价（input/output 每百万 token） */
  pricing?: { input: number; output: number; cacheRead?: number };
  /** 任意额外字段，透传到 APIPreset */
  extra?: Record<string, unknown>;
}

/** 配置文件结构（纯动态，无硬编码） */
export interface LLMConfigFile {
  /** 文件版本，便于以后迁移 */
  version?: 1;
  /** 当前激活的自定义配置名（可选） */
  active?: string;
  /** 自定义厂商列表（持久化） */
  providers?: CustomProvider[];
  /** 自定义单模型配置列表（持久化） */
  presets?: CustomPreset[];
}

/** 自定义厂商配置（持久化） */
export interface CustomProvider {
  /** 厂商 ID */
  id: string;
  /** 展示名 */
  name: string;
  /** 默认协议 */
  protocol: string;
  /** 默认 API 端点 */
  baseUrl: string;
  /** 读取 API key 的环境变量名 */
  envKey?: string;
  /** 模型列表 */
  models: CustomModel[];
}

/** 自定义模型配置（属于某个厂商） */
export interface CustomModel {
  /** 模型 ID */
  id: string;
  /** 展示名 */
  name?: string;
  /** 覆盖厂商默认协议 */
  protocol?: string;
  /** 覆盖厂商默认端点 */
  baseUrl?: string;
  /** 输入模态 */
  input?: Array<"text" | "image" | "audio" | "pdf" | "video">;
  /** 输出模态 */
  output?: Array<"text" | "image" | "audio">;
  /** 是否支持推理/思考 */
  reasoning?: boolean;
  /** 是否支持原生工具调用 */
  toolCall?: boolean;
  /** 输入上下文窗口（token） */
  contextWindow?: number;
  /** 单次输出 token 上限 */
  maxTokens?: number;
  /** 定价（每百万 token） */
  pricing?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; currency?: string };
  /** 知识截止（如 "2024-10"） */
  knowledge?: string;
}

export interface LLMConfigOptions {
  /** 配置文件路径（默认 ~/.maou/llm-config.json） */
  configPath?: string;
  /** 是否在构造时自动加载文件（默认 true） */
  autoload?: boolean;
  /**
   * 是否使用内置注册表（默认 true）
   * @deprecated 内置注册表现在仅作为运行时缓存，不再包含硬编码目录
   */
  builtin?: boolean;
}

export class LLMConfig {
  private readonly configPath: string;
  private readonly useBuiltin: boolean;
  /** 持久化的自定义厂商 */
  private customProviders = new Map<string, CustomProvider>();
  /** 持久化的单模型配置 */
  private customs = new Map<string, CustomPreset>();
  /** 运行时注册的厂商（不持久化） */
  private runtimeProviders = new Map<string, ProviderSpec>();
  private activeName: string | undefined;
  private loaded = false;

  constructor(opts: LLMConfigOptions = {}) {
    this.configPath = opts.configPath ?? DEFAULT_CONFIG_PATH;
    this.useBuiltin = opts.builtin ?? true;
    if (opts.autoload ?? true) {
      this.load();
    }
  }

  // ── 文件加载 / 保存 ──

  /** 从配置文件加载（文件不存在则空载，不报错） */
  load(): void {
    this.loaded = true;
    if (!existsSync(this.configPath)) {
      return;
    }
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const data = JSON.parse(raw) as LLMConfigFile;
      this.activeName = data.active;

      // 加载持久化的自定义厂商
      for (const p of data.providers ?? []) {
        if (p?.id) this.customProviders.set(p.id, p);
      }

      // 加载持久化的单模型配置
      for (const p of data.presets ?? []) {
        if (p?.name) this.customs.set(p.name, p);
      }
    } catch {
      // 配置文件损坏时静默空载，避免阻断启动
    }
  }

  /** 写回文件（原子：写临时文件再 rename） */
  async save(): Promise<void> {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: LLMConfigFile = {
      version: 1,
      active: this.activeName,
      providers: [...this.customProviders.values()],
      presets: [...this.customs.values()],
    };
    const tmp = `${this.configPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmp, this.configPath);
  }

  /** 配置文件路径 */
  get path(): string {
    return this.configPath;
  }

  // ── 自定义厂商 CRUD（持久化）──

  /** 添加/覆盖自定义厂商（不入文件，需 save() 持久化） */
  addCustomProvider(provider: CustomProvider): this {
    this.customProviders.set(provider.id, provider);
    return this;
  }

  /** 删除自定义厂商 */
  removeCustomProvider(id: string): boolean {
    return this.customProviders.delete(id);
  }

  /** 获取自定义厂商 */
  getCustomProvider(id: string): CustomProvider | null {
    return this.customProviders.get(id) ?? null;
  }

  /** 列出所有自定义厂商 */
  listCustomProviders(): CustomProvider[] {
    return [...this.customProviders.values()];
  }

  // ── 运行时注册（不持久化）──

  /** 运行时注册厂商（不持久化，重启丢失） */
  registerProvider(spec: ProviderSpec): this {
    this.runtimeProviders.set(spec.id, spec);
    return this;
  }

  /** 运行时注册模型到已有厂商（不持久化） */
  registerModel(providerId: string, model: ModelSpec): this {
    let p = this.runtimeProviders.get(providerId);
    if (!p) {
      p = { id: providerId, name: providerId, protocol: model.protocol, baseUrl: model.baseUrl ?? "", models: [] };
      this.runtimeProviders.set(providerId, p);
    }
    const idx = p.models.findIndex((m) => m.id === model.id);
    if (idx >= 0) p.models[idx] = model;
    else p.models.push(model);
    return this;
  }

  // ── 单模型配置 CRUD（持久化）──

  /** 添加/覆盖单模型配置（不入文件，需 save() 持久化） */
  addCustom(preset: CustomPreset): this {
    this.customs.set(preset.name, preset);
    return this;
  }

  removeCustom(name: string): boolean {
    return this.customs.delete(name);
  }

  getCustom(name: string): CustomPreset | null {
    return this.customs.get(name) ?? null;
  }

  listCustoms(): CustomPreset[] {
    return [...this.customs.values()];
  }

  /** 设当前激活的自定义配置名 */
  setActive(name: string | undefined): this {
    this.activeName = name;
    return this;
  }

  getActive(): CustomPreset | null {
    return this.activeName ? this.customs.get(this.activeName) ?? null : null;
  }

  // ── 合并查询（文件 + 运行时 + 单模型配置）──

  /** 列出所有厂商：持久化自定义 + 运行时注册 */
  listProviders(): string[] {
    const set = new Set<string>();
    // 持久化的自定义厂商
    for (const p of this.customProviders.values()) set.add(p.id);
    // 运行时注册的厂商
    for (const p of this.runtimeProviders.values()) set.add(p.id);
    // 单模型配置中声明的 provider
    for (const c of this.customs.values()) if (c.provider) set.add(c.provider);
    return [...set];
  }

  /** 列出某厂商的全部模型：持久化 + 运行时 + 单模型配置（合并） */
  listModels(provider: string): ModelSpec[] {
    const models: ModelSpec[] = [];

    // 1. 持久化的自定义厂商
    const customProvider = this.customProviders.get(provider);
    if (customProvider) {
      for (const m of customProvider.models) {
        models.push(this.customModelToSpec(m, provider, customProvider));
      }
    }

    // 2. 运行时注册的厂商
    const runtimeProvider = this.runtimeProviders.get(provider);
    if (runtimeProvider) {
      models.push(...runtimeProvider.models);
    }

    // 3. 单模型配置
    const customs = [...this.customs.values()]
      .filter((c) => (c.provider ?? this.inferProvider(c)) === provider)
      .map((c) => this.customToSpec(c));
    models.push(...customs);

    return models;
  }

  /** 取某厂商下指定 id 的模型（持久化优先，否则运行时，最后单模型配置） */
  getModel(provider: string, id: string): ModelSpec | null {
    // 1. 持久化的自定义厂商
    const customProvider = this.customProviders.get(provider);
    if (customProvider) {
      const m = customProvider.models.find((mm) => mm.id === id);
      if (m) return this.customModelToSpec(m, provider, customProvider);
    }

    // 2. 运行时注册的厂商
    const runtimeProvider = this.runtimeProviders.get(provider);
    if (runtimeProvider) {
      const m = runtimeProvider.models.find((mm) => mm.id === id);
      if (m) return m;
    }

    // 3. 单模型配置
    const c = this.customs.get(id);
    if (c && (c.provider ?? this.inferProvider(c)) === provider) return this.customToSpec(c);

    return null;
  }

  /** 跨厂商按模型 id 查找 */
  findModel(id: string): ModelSpec | null {
    // 先查持久化厂商
    for (const p of this.customProviders.values()) {
      const m = p.models.find((mm) => mm.id === id);
      if (m) return this.customModelToSpec(m, p.id, p);
    }
    // 再查运行时厂商
    for (const p of this.runtimeProviders.values()) {
      const m = p.models.find((mm) => mm.id === id);
      if (m) return m;
    }
    // 最后查单模型配置
    const c = this.customs.get(id);
    if (c) return this.customToSpec(c);
    return null;
  }

  /** 列出所有模型（跨厂商扁平化） */
  listAllModels(): ModelSpec[] {
    const out: ModelSpec[] = [];
    for (const p of this.customProviders.values()) {
      for (const m of p.models) {
        out.push(this.customModelToSpec(m, p.id, p));
      }
    }
    for (const p of this.runtimeProviders.values()) {
      out.push(...p.models);
    }
    for (const c of this.customs.values()) {
      out.push(this.customToSpec(c));
    }
    return out;
  }

  /** 获取厂商详情（持久化优先，否则运行时） */
  getProvider(id: string): ProviderSpec | null {
    const custom = this.customProviders.get(id);
    if (custom) {
      return {
        id: custom.id,
        name: custom.name,
        protocol: normalizeApiProtocol(custom.protocol) as APIProtocol,
        baseUrl: custom.baseUrl,
        envKey: custom.envKey,
        models: custom.models.map((m) => this.customModelToSpec(m, id, custom)),
      };
    }
    return this.runtimeProviders.get(id) ?? null;
  }

  // ── 转 APIPreset（给 LLMClient 用）──

  /**
   * 把配置转成 LLMClient 用的 APIPreset。
   * 支持三种形态：
   *   1. toAPIPreset("my-custom") —— 单模型配置名
   *   2. toAPIPreset("provider", "model-id") —— 厂商/模型
   */
  toAPIPreset(nameOrProvider: string, modelId?: string): APIPreset {
    // 形态一：toAPIPreset("my-custom") —— 单模型配置名
    if (modelId === undefined) {
      const c = this.customs.get(nameOrProvider);
      if (c) return this.customToAPIPreset(c);
      throw new Error(`未找到单模型配置: ${nameOrProvider}`);
    }

    // 形态二：toAPIPreset("provider", "model-id")
    // 1. 持久化的自定义厂商
    const customProvider = this.customProviders.get(nameOrProvider);
    if (customProvider) {
      const m = customProvider.models.find((mm) => mm.id === modelId);
      if (m) return this.customModelToAPIPreset(m, nameOrProvider, customProvider);
    }

    // 2. 运行时注册的厂商
    const runtimeProvider = this.runtimeProviders.get(nameOrProvider);
    if (runtimeProvider) {
      const m = runtimeProvider.models.find((mm) => mm.id === modelId);
      if (m) {
        const key = getEnvApiKey(nameOrProvider);
        const preset: APIPreset = {
          name: `${nameOrProvider}/${modelId}`,
          model: m.id,
          url: m.baseUrl ?? runtimeProvider.baseUrl,
          protocol: m.protocol,
          supportsVision: m.input.includes("image"),
          supportsReasoning: m.reasoning,
          nativeToolCalling: m.toolCall,
          maxTokens: m.maxTokens,
          maxContext: m.contextWindow,
        };
        if (key) preset.key = key;
        if (m.pricing) {
          (preset as Record<string, unknown>).pricing = {
            inputPrice: m.pricing.input,
            outputPrice: m.pricing.output,
            cacheHitPrice: m.pricing.cacheRead ?? 0,
            currency: m.pricing.currency ?? "USD",
          };
        }
        return preset;
      }
    }

    // 3. 单模型配置
    const c = this.customs.get(modelId);
    if (c && (c.provider ?? this.inferProvider(c)) === nameOrProvider) {
      return this.customToAPIPreset(c);
    }

    throw new Error(`未找到配置: ${nameOrProvider}/${modelId}`);
  }

  // ── 远程能力（保留旧 PresetManager 的实用功能）──

  /** 从某自定义配置对应的 /v1/models 端点远程拉可用模型列表 */
  async fetchRemoteModels(name: string): Promise<string[]> {
    const c = this.customs.get(name);
    if (!c) throw new Error(`未找到自定义配置: ${name}`);
    const baseUrl = c.url
      .replace(/\/chat\/completions$/, "")
      .replace(/\/v1\/messages$/, "")
      .replace(/\/v1\/responses$/, "")
      .replace(/\/v1$/, "")
      .replace(/\/+$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (c.key) headers["Authorization"] = `Bearer ${c.key}`;
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`拉取模型失败 (${res.status})`);
    const data = (await res.json()) as Record<string, unknown>;
    const list = (data.data ?? data.models) as Array<Record<string, unknown>> | undefined;
    return list ? list.map((m) => String(m.id ?? m.name ?? "")) : [];
  }

  // ── 内部转换 ──

  /** CustomModel → ModelSpec */
  private customModelToSpec(m: CustomModel, providerId: string, provider: CustomProvider): ModelSpec {
    return {
      id: m.id,
      provider: providerId,
      name: m.name ?? m.id,
      protocol: normalizeApiProtocol(m.protocol ?? provider.protocol) as ModelSpec["protocol"],
      baseUrl: m.baseUrl ?? provider.baseUrl,
      input: m.input ?? ["text"],
      output: m.output ?? ["text"],
      reasoning: m.reasoning ?? false,
      toolCall: m.toolCall ?? true,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      pricing: m.pricing ? { input: m.pricing.input, output: m.pricing.output, cacheRead: m.pricing.cacheRead, cacheWrite: m.pricing.cacheWrite, currency: m.pricing.currency } : undefined,
      knowledge: m.knowledge,
    };
  }

  /** CustomModel → APIPreset */
  private customModelToAPIPreset(m: CustomModel, providerId: string, provider: CustomProvider): APIPreset {
    const protocol = normalizeApiProtocol(m.protocol ?? provider.protocol) as APIProtocol;
    const url = completeApiUrl(m.baseUrl ?? provider.baseUrl, protocol);
    const preset: APIPreset = {
      name: `${providerId}/${m.id}`,
      model: m.id,
      url,
      protocol,
      supportsVision: (m.input ?? ["text"]).includes("image"),
      supportsReasoning: m.reasoning ?? false,
      nativeToolCalling: m.toolCall ?? true,
      maxTokens: m.maxTokens,
      maxContext: m.contextWindow,
    };
    // key：环境变量
    const key = provider.envKey ? getEnvApiKey(providerId) : undefined;
    if (key) preset.key = key;
    if (m.pricing) {
      (preset as Record<string, unknown>).pricing = {
        inputPrice: m.pricing.input,
        outputPrice: m.pricing.output,
        cacheHitPrice: m.pricing.cacheRead ?? 0,
        currency: m.pricing.currency ?? "USD",
      };
    }
    return preset;
  }

  /** 由单模型配置推断 provider（按 protocol/url） */
  private inferProvider(c: CustomPreset): string {
    const proto = normalizeApiProtocol(c.protocol);
    if (proto === "anthropic") return "anthropic";
    if (proto === "google" || proto === "google-vertex") return "google";
    if (proto === "mistral") return "mistral";
    if (proto === "bedrock") return "bedrock";
    return c.provider ?? "custom";
  }

  /** CustomPreset → ModelSpec */
  private customToSpec(c: CustomPreset): ModelSpec {
    const provider = c.provider ?? this.inferProvider(c);
    return {
      id: c.model,
      provider,
      name: c.name,
      protocol: normalizeApiProtocol(c.protocol) as ModelSpec["protocol"],
      baseUrl: c.url,
      input: c.supportsVision ? ["text", "image"] : ["text"],
      output: ["text"],
      reasoning: c.supportsReasoning ?? false,
      toolCall: c.nativeToolCalling ?? true,
      contextWindow: c.maxContext,
      maxTokens: c.maxTokens,
      pricing: c.pricing ? { input: c.pricing.input, output: c.pricing.output, cacheRead: c.pricing.cacheRead } : undefined,
    };
  }

  /** CustomPreset → APIPreset */
  private customToAPIPreset(c: CustomPreset): APIPreset {
    const protocol = normalizeApiProtocol(c.protocol) as APIProtocol;
    const url = completeApiUrl(c.url, protocol);
    const preset: APIPreset = {
      name: c.name,
      model: c.model,
      url,
      protocol,
      supportsVision: c.supportsVision,
      supportsReasoning: c.supportsReasoning,
      nativeToolCalling: c.nativeToolCalling ?? true,
      maxTokens: c.maxTokens,
      maxContext: c.maxContext,
    };
    // key：显式 > 环境变量
    const key = c.key ?? (c.provider ? getEnvApiKey(c.provider) : undefined);
    if (key) preset.key = key;
    if (c.extra) Object.assign(preset, c.extra);
    return preset;
  }
}
