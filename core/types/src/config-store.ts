import { readFileSync, existsSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { z } from 'zod'
import { parse as parseJsonc } from 'jsonc-parser'
import type {
  AppConfig,
  LLMPreset,
  ContextSettings,
  PluginSettings,
  LLMProtocol,
  ApiProvider,
} from './index.js'
import { resolveUserConfigPath } from './maou-paths.js'
import { resolveApiRolePreset, type ApiModelRole } from './api-roles.js'
import { normalizeRuntimePreset } from './preset-normalize.js'
import { migratePresetPlainKey } from './secrets-store.js'
import {
  apiDocumentForDisk,
  coerceApiDocument,
  providersToRuntimePresets,
} from './api-providers.js'

export { normalizeRuntimePreset, normalizeLoadedPreset } from './preset-normalize.js'

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const LLMProtocolSchema = z.enum([
  'openai',
  'anthropic',
  'openai-responses',
  'responses',
  'google',
  'mistral',
  'bedrock',
  'azure',
  'cloudflare',
  'google-vertex',
  'openai-codex',
  'github-copilot',
  'faux',
])

/**
 * LLM preset schema。
 * 核心字段有默认值；扩展字段（extraBody / pricing / 采样 / 并发 / 多模态）
 * 经 .passthrough() 保留，避免 WebUI 写入后被 Zod strip 成「假配置」。
 */
/** 厂商内单模型条目（api.presets[].models[]） */
const LLMModelSpecSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    maxTokens: z.number().int().positive().optional(),
    maxContext: z.number().int().positive().optional(),
    supportsVision: z.boolean().optional(),
    supportsReasoning: z.boolean().optional(),
    supportsAudio: z.boolean().optional(),
    supportsVideo: z.boolean().optional(),
    nativeToolCalling: z.boolean().optional(),
    nativeStructuredOutput: z.boolean().optional(),
    inputPrice: z.number().optional(),
    outputPrice: z.number().optional(),
    cacheHitPrice: z.number().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    presencePenalty: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    extraBody: z.record(z.unknown()).optional(),
  })
  .passthrough()

const LLMPresetSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    key: z.string().default(''),
    /**
     * 可选展示用默认 model id；权威来源是 models[]。
     * 加载后会 expand 成运行时每条必有 model。
     */
    model: z.string().optional().default(''),
    /** 厂商内多模型列表（磁盘必填，至少一项） */
    models: z.array(LLMModelSpecSchema).min(1),
    defaultModel: z.string().optional(),
    maxTokens: z.number().int().positive().default(65536),
    maxContext: z.number().int().positive().optional(),
    protocol: LLMProtocolSchema.default('openai'),
    stream: z.boolean().default(true),
    supportsVision: z.boolean().default(false),
    supportsReasoning: z.boolean().default(false),
    supportsAudio: z.boolean().optional(),
    supportsVideo: z.boolean().optional(),
    nativeToolCalling: z.boolean().default(true),
    nativeStructuredOutput: z.boolean().default(true),
    structuredOutputMode: z.enum(['json_object', 'json_schema']).optional(),
    /** camelCase（normalizeKeys 后）；运行时另写 reasoning_params 给 adapter */
    reasoningParams: z.record(z.unknown()).optional(),
    extraBody: z.record(z.unknown()).optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    presencePenalty: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    maxConcurrent: z.number().optional(),
    inputPrice: z.number().optional(),
    outputPrice: z.number().optional(),
    cacheHitPrice: z.number().optional(),
    pricing: z
      .object({
        inputPrice: z.number().optional(),
        outputPrice: z.number().optional(),
        cacheHitPrice: z.number().optional(),
        input: z.number().optional(),
        output: z.number().optional(),
        cacheRead: z.number().optional(),
        currency: z.string().optional(),
      })
      .passthrough()
      .optional(),
    vendor: z.string().optional(),
    urlParams: z.string().optional(),
    customRequestJson: z.string().optional(),
    oauth: z.boolean().optional(),
    oauthProvider: z
      .enum(["anthropic", "openai-codex", "github-copilot", "google", "xai"])
      .optional(),
  })
  .passthrough()

const ContextSettingsSchema = z.object({
  thresholdPercent: z.number().min(0).max(100).default(70),
  keepRecentPercent: z.number().min(0).max(100).default(25),
})

const PluginSettingsSchema = z.object({
  plugins: z.record(z.object({ enabled: z.boolean() })).optional(),
  signalRender: z.object({
    imagePath: z.string().optional(),
    imageFit: z.string().optional(),
  }).optional(),
}).passthrough()

/** 旧 roles：name / 下标；新 roles：{ provider, model } */
const PresetRefSchema = z.union([
  z.string(),
  z.number().int().min(0),
  z.object({
    provider: z.string().min(1),
    model: z.string().optional().default(''),
  }),
])

const ApiModelRolesSchema = z
  .object({
    main: PresetRefSchema.optional(),
    fast: PresetRefSchema.optional(),
    vision: PresetRefSchema.optional(),
    helper: PresetRefSchema.optional(),
  })
  .catchall(PresetRefSchema)
  .optional()

const ApiProviderSchema = z
  .object({
    displayName: z.string().optional(),
    url: z.string().default(''),
    protocol: z.string().default('openai'),
    key: z.string().optional().default(''),
    keyRef: z.string().optional(),
    models: z.array(LLMModelSpecSchema).min(1),
    defaultModel: z.string().optional(),
  })
  .passthrough()

const ApiConfigSchema = z.object({
  providers: z.record(ApiProviderSchema).default({}),
  presets: z.array(LLMPresetSchema).default([]),
  defaultPreset: z.number().int().min(0).optional(),
  helperPreset: z.number().int().min(0).optional(),
  roles: ApiModelRolesSchema,
  agentRoundLimit: z.number().int().positive().default(50),
  contextSettings: ContextSettingsSchema.default({}),
  pluginSettings: PluginSettingsSchema.optional(),
})

const SecurityConfigSchema = z.object({
  sandboxMode: z.string().default('normal'),
  dangerousCommandsRequireApproval: z.boolean().default(true),
  allowedHosts: z.array(z.string()).optional(),
  blockedCommands: z.array(z.string()).optional(),
})

const TerminalConfigSchema = z.object({
  mode: z.enum(['full', 'mini']).default('full'),
  shell: z.string().min(1).optional(),
})

const AppConfigSchema = z.object({
  api: ApiConfigSchema.default({}),
  security: SecurityConfigSchema.optional(),
  ui: z.record(z.unknown()).optional(),
  terminal: TerminalConfigSchema.optional(),
}).passthrough()

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return parseJsonc(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** snake_case → camelCase */
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

/** 递归将对象键从 snake_case 转为 camelCase */
function normalizeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key)
    if (isPlainObject(value)) {
      result[camelKey] = normalizeKeys(value)
    } else {
      result[camelKey] = value
    }
  }
  return result
}

/** 深度合并：source 覆盖 target。调用处 deepMerge(userRaw, projectRaw)，即 project 覆盖 user。 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const tVal = result[key]
    const sVal = source[key]
    if (isPlainObject(tVal) && isPlainObject(sVal)) {
      result[key] = deepMerge(tVal, sVal)
    } else if (sVal !== undefined) {
      result[key] = sVal
    }
  }
  return result
}

function migrateProviderKeys(providers: Record<string, ApiProvider>, userRoot: string): boolean {
  let dirty = false
  for (const p of Object.values(providers)) {
    if (!p || typeof p !== 'object') continue
    const rec = p as unknown as Record<string, unknown>
    if (migratePresetPlainKey(rec, userRoot)) dirty = true
    if (Array.isArray(rec.models)) {
      for (const m of rec.models) {
        if (m && typeof m === 'object' && migratePresetPlainKey(m as Record<string, unknown>, userRoot)) {
          dirty = true
        }
      }
    }
  }
  return dirty
}

function flattenProvidersInConfig(config: AppConfig, userRoot?: string): AppConfig {
  const providers = (config.api?.providers ?? {}) as Record<string, ApiProvider>
  if (userRoot) migrateProviderKeys(providers, userRoot)
  const expanded = providersToRuntimePresets(providers)
  const next = expanded.map((item) =>
    normalizeRuntimePreset(item) as LLMPreset,
  )
  return {
    ...config,
    api: {
      ...config.api,
      providers,
      presets: next,
    },
  }
}

// ─── ConfigStore ────────────────────────────────────────────────────────────

/**
 * 配置存储
 * 加载 project_config.json（项目级开关）和
 * **全局** config.json（全系列产品共用：LLM api.providers 等），深度合并后用 Zod 校验。
 *
 * 分工：
 * - 用户态 config.json（~/.maou 或 $MAOU_HOME，可用 $MAOU_LLM_CONFIG 覆盖路径）：
 *   LLM 配置（api.providers）等全局应用配置的**唯一权威源**，所有 maou 系列产品共用。
 * - project_config.json：项目级开关，跟着 git 走。**不放 api 段**。
 * - 项目态 <cwd>/.maou：会话等，**不放 API key**。
 */
export class ConfigStore {
  private config: AppConfig
  private projectPath: string
  private userPath: string

  constructor(projectRoot: string, userRoot?: string) {
    // 项目配置：优先项目根目录，回退 core/agent_factory/
    const projectCfg = join(projectRoot, 'project_config.json')
    const projectCfgFallback = join(projectRoot, 'core', 'agent_factory', 'project_config.json')
    this.projectPath = existsSync(projectCfg) ? projectCfg : projectCfgFallback

    // 始终指向用户态全局配置（系列产品共用）；不回退到 projectRoot/.maou
    // userRoot 为目录时 resolveUserConfigPath 在其下找 config.json；也可被 MAOU_LLM_CONFIG 覆盖
    this.userPath = resolveUserConfigPath(userRoot)
    this.config = this.load()
  }

  /** 全局配置文件绝对路径（调试 / setup 用） */
  getUserConfigPath(): string {
    return this.userPath
  }

  /** 加载并合并配置 */
  private load(): AppConfig {
    const userRaw = readJsonFile(this.userPath)
    if (userRaw.api && typeof userRaw.api === 'object') {
      const prevApi = userRaw.api as Record<string, unknown>
      const doc = coerceApiDocument(prevApi)
      const keyDirty = migrateProviderKeys(doc.providers, dirname(this.userPath))
      if (doc.dirty || keyDirty) {
        userRaw.api = apiDocumentForDisk(prevApi, doc)
        this.writeUserFile(userRaw)
      } else {
        userRaw.api = { ...prevApi, providers: doc.providers, roles: doc.roles }
        delete (userRaw.api as Record<string, unknown>).presets
        delete (userRaw.api as Record<string, unknown>).defaultPreset
        delete (userRaw.api as Record<string, unknown>).helperPreset
      }
    }

    const projectRaw = readJsonFile(this.projectPath)
    const merged = deepMerge(userRaw, projectRaw)
    const normalized = normalizeKeys(merged)
    const result = AppConfigSchema.safeParse(normalized)
    const userRoot = dirname(this.userPath)
    if (result.success) {
      return flattenProvidersInConfig(result.data, userRoot)
    }
    console.warn('[ConfigStore] 配置校验失败，使用默认值:', result.error.flatten())
    return flattenProvidersInConfig(AppConfigSchema.parse({}), userRoot)
  }

  private writeUserFile(data: Record<string, unknown>): void {
    mkdirSync(dirname(this.userPath), { recursive: true })
    writeFileSync(this.userPath, JSON.stringify(data, null, 2), 'utf-8')
    try {
      chmodSync(this.userPath, 0o600)
    } catch {
      /* Windows 等可能不支持 */
    }
  }

  /** 重新加载配置 */
  reload(): void {
    this.config = this.load()
  }

  /** 获取完整配置 */
  get(): AppConfig {
    return this.config
  }

  /** 获取指定索引的 LLM 预设（未传 index 时尊重 roles.main / defaultPreset） */
  getPreset(index?: number): LLMPreset {
    const presets = this.config.api.presets
    if (index === undefined) {
      const byRole = resolveApiRolePreset(this.config.api, 'main')
      if (byRole) return byRole
    }
    const idx = index ?? this.config.api.defaultPreset ?? 0
    return presets[idx] ?? presets[0] ?? {
      name: 'default',
      url: 'https://api.openai.com/v1',
      key: '',
      model: 'gpt-4o',
      maxTokens: 65536,
      protocol: 'openai' as LLMProtocol,
      stream: true,
      supportsVision: false,
      supportsReasoning: false,
      nativeToolCalling: true,
      nativeStructuredOutput: true,
    }
  }

  /**
   * 按角色取 preset：main | fast | vision | helper | 自定义。
   * 见 config.api.roles。
   */
  getRolePreset(role: ApiModelRole = 'main'): LLMPreset {
    return (
      resolveApiRolePreset(this.config.api, role) ??
      this.getPreset()
    )
  }

  /** 获取上下文窗口管理设置 */
  getContextSettings(): ContextSettings {
    return this.config.api.contextSettings
  }

  /** 获取插件设置 */
  getPluginSettings(): PluginSettings {
    return this.config.api.pluginSettings ?? {}
  }

  /** 获取安全配置 */
  getSecurity() {
    return this.config.security
  }

  /** 获取原始配置值（未校验），不传 key 返回完整 raw 配置 */
  getRaw(key?: string): unknown {
    const raw = this.config as unknown as Record<string, unknown>;
    return key ? raw[key] : raw;
  }

  /** 获取用户配置文件原始内容 */
  getUserRaw(): Record<string, unknown> {
    return readJsonFile(this.userPath)
  }

  /** 获取项目配置文件原始内容 */
  getProjectRaw(): Record<string, unknown> {
    return readJsonFile(this.projectPath)
  }

  /** 保存用户配置（全局 API 等）；尽量 chmod 0600 保护 key */
  saveUserConfig(data: Record<string, unknown>): void {
    const userRoot = dirname(this.userPath)
    const api = data.api && typeof data.api === 'object' ? (data.api as Record<string, unknown>) : null
    if (api) {
      const doc = coerceApiDocument(api)
      migrateProviderKeys(doc.providers, userRoot)
      data.api = apiDocumentForDisk(api, doc)
    }
    this.writeUserFile(data)
    this.reload()
  }

  /** 保存项目配置 */
  saveProjectConfig(data: Record<string, unknown>): void {
    mkdirSync(dirname(this.projectPath), { recursive: true })
    writeFileSync(this.projectPath, JSON.stringify(data, null, 2), 'utf-8')
    this.reload()
  }

  /** 获取默认插件设置 */
  getDefaultPluginSettings(): { plugins: Record<string, Record<string, unknown>> } {
    return { plugins: {} }
  }

  /** 切换插件启用状态 */
  togglePlugin(pluginId: string, enabled: boolean): void {
    const ps = this.config.api.pluginSettings ?? {}
    if (!ps.plugins) ps.plugins = {}
    ps.plugins[pluginId] = { enabled }
    this.config.api.pluginSettings = ps
  }

  /** 保存插件设置 */
  savePluginSettings(data: Record<string, unknown>): void {
    this.config.api.pluginSettings = data as PluginSettings
  }
}
