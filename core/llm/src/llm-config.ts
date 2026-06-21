/**
 * LLMConfig —— 统一的 LLM 配置管理器
 *
 * 一套机制覆盖三层：
 *   ① 内置厂商目录（来自 registry：getModel/getProviders + 定价 + 能力）
 *   ② 自定义配置（程序内 add / 从配置文件加载）
 *   ③ 配置文件（默认 ~/.maou/llm-config.json，路径可自定义；启动自动加载，save() 写回）
 *
 * 设计目标：LLM SDK 一个入口解决所有厂商配置 + 自定义配置 + 文件持久化。
 * 替代旧的 PresetManager（文件扫描）+ 裸 registry（纯内存）二选一的局面。
 *
 * @example
 * // 默认：自动从 ~/.maou/llm-config.json 加载自定义配置 + 合并内置目录
 * const config = new LLMConfig();
 * await config.load();
 *
 * // 自定义路径
 * const config = new LLMConfig({ configPath: "/my/llm.json" });
 *
 * // 程序内加自定义配置，写回文件
 * config.addCustom({ name: "my-local", provider: "ollama", model: "llama3", url: "http://localhost:11434/v1/chat/completions", protocol: "openai" });
 * await config.save();
 *
 * // 查询：内置 + 自定义合并
 * config.listModels("anthropic");
 * const preset = config.toAPIPreset("my-local");  // 一键转 LLMClient 用的 APIPreset
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import {
  getProviders,
  getModels as registryGetModels,
  getModel as registryGetModel,
  registerProvider,
  registerModel,
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

/** 配置文件结构（新格式） */
export interface LLMConfigFile {
  /** 文件版本，便于以后迁移 */
  version?: 1;
  /** 当前激活的自定义配置名（可选） */
  active?: string;
  /** 自定义配置列表 */
  presets: CustomPreset[];
}

export interface LLMConfigOptions {
  /** 配置文件路径（默认 ~/.maou/llm-config.json） */
  configPath?: string;
  /** 是否在构造时自动加载文件（默认 true） */
  autoload?: boolean;
  /** 是否合并内置厂商目录（默认 true） */
  builtin?: boolean;
}

export class LLMConfig {
  private readonly configPath: string;
  private readonly useBuiltin: boolean;
  private customs = new Map<string, CustomPreset>();
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

  /** 从配置文件加载自定义配置（文件不存在则空载，不报错） */
  load(): void {
    this.loaded = true;
    if (!existsSync(this.configPath)) {
      return;
    }
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      const data = JSON.parse(raw) as LLMConfigFile;
      this.activeName = data.active;
      for (const p of data.presets ?? []) {
        if (p?.name) this.customs.set(p.name, p);
      }
    } catch {
      // 配置文件损坏时静默空载，避免阻断启动
    }
  }

  /** 把自定义配置写回文件（原子：写临时文件再 rename） */
  async save(): Promise<void> {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: LLMConfigFile = {
      version: 1,
      active: this.activeName,
      presets: [...this.customs.values()],
    };
    const tmp = `${this.configPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    const { renameSync } = await import("node:fs");
    renameSync(tmp, this.configPath);
  }

  /** 配置文件路径 */
  get path(): string {
    return this.configPath;
  }

  // ── 自定义配置 CRUD ──

  /** 新增/覆盖一个自定义配置（不入文件，需 save() 持久化） */
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

  // ── 内置 + 自定义合并查询 ──

  /** 列出所有 provider：内置 + 自定义里声明了 provider 的 */
  listProviders(): string[] {
    const set = new Set<string>();
    if (this.useBuiltin) for (const p of getProviders()) set.add(p.id);
    for (const c of this.customs.values()) if (c.provider) set.add(c.provider);
    return [...set];
  }

  /** 列出某 provider 的全部模型：内置目录 + 自定义配置（合并） */
  listModels(provider: string): ModelSpec[] {
    const models = this.useBuiltin ? registryGetModels(provider) : [];
    const customs = [...this.customs.values()]
      .filter((c) => (c.provider ?? this.inferProvider(c)) === provider)
      .map((c) => this.customToSpec(c));
    return [...models, ...customs];
  }

  /** 取某 provider 下指定 id 的模型（内置优先，否则自定义） */
  getModel(provider: string, id: string): ModelSpec | null {
    if (this.useBuiltin) {
      const m = registryGetModel(provider, id);
      if (m) return m;
    }
    const c = this.customs.get(id);
    if (c && (c.provider ?? this.inferProvider(c)) === provider) return this.customToSpec(c);
    return null;
  }

  /** 跨 provider 按名/id 找自定义配置 */
  findCustom(name: string): CustomPreset | null {
    return this.customs.get(name) ?? null;
  }

  // ── 转 APIPreset（给 LLMClient 用）──

  /**
   * 把一个配置转成 LLMClient 用的 APIPreset。
   * 解析顺序：自定义配置(name) → 内置 provider/model → key 自动从环境变量补。
   */
  toAPIPreset(nameOrProvider: string, modelId?: string): APIPreset {
    // 形态一：toAPIPreset("my-custom") —— 自定义配置名
    if (modelId === undefined) {
      const c = this.customs.get(nameOrProvider);
      if (c) return this.customToAPIPreset(c);
      throw new Error(`未找到自定义配置: ${nameOrProvider}`);
    }
    // 形态二：toAPIPreset("anthropic", "claude-sonnet-4-5") —— 内置 provider/model
    if (this.useBuiltin) {
      const m = registryGetModel(nameOrProvider, modelId);
      if (m) {
        const key = getEnvApiKey(nameOrProvider);
        const p = registryToAPIPreset(nameOrProvider, modelId, key ? { key } : undefined);
        if (key) p.key = key;
        return p;
      }
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

  // ── 内部 ──

  /** 由自定义配置推断 provider（按 protocol/url） */
  private inferProvider(c: CustomPreset): string {
    const proto = normalizeApiProtocol(c.protocol);
    if (proto === "anthropic") return "anthropic";
    if (proto === "google" || proto === "google-vertex") return "google";
    if (proto === "mistral") return "mistral";
    if (proto === "bedrock") return "bedrock";
    return c.provider ?? "custom";
  }

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
