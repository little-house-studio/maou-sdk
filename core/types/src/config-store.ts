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
} from './index.js'
import { resolveUserConfigPath } from './maou-paths.js'
import { resolveApiRolePreset, type ApiModelRole } from './api-roles.js'

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const LLMProtocolSchema = z.enum(['openai', 'anthropic', 'openai-responses'])

const LLMPresetSchema = z.object({
  name: z.string(),
  url: z.string(),
  key: z.string().default(''),
  model: z.string(),
  maxTokens: z.number().int().positive().default(65536),
  maxContext: z.number().int().positive().optional(),
  protocol: LLMProtocolSchema.default('openai'),
  stream: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  supportsReasoning: z.boolean().default(false),
  nativeToolCalling: z.boolean().default(true),
  nativeStructuredOutput: z.boolean().default(true),
  structuredOutputMode: z.enum(['json_object', 'json_schema']).optional(),
  reasoningParams: z.record(z.unknown()).optional(),
})

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

/** preset 引用：name 字符串或数组下标 */
const PresetRefSchema = z.union([z.string(), z.number().int().min(0)])

const ApiModelRolesSchema = z
  .object({
    main: PresetRefSchema.optional(),
    fast: PresetRefSchema.optional(),
    vision: PresetRefSchema.optional(),
    helper: PresetRefSchema.optional(),
  })
  .catchall(PresetRefSchema)
  .optional()

const ApiConfigSchema = z.object({
  presets: z.array(LLMPresetSchema).default([]),
  defaultPreset: z.number().int().min(0).default(0),
  /**
   * 全局辅助模型 preset 索引（可选，兼容旧配置）。
   * 优先 roles.helper；再 helperPreset；再 main。
   */
  helperPreset: z.number().int().min(0).optional(),
  /** 按用途绑定模型：main / fast / vision / helper … */
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

const AppConfigSchema = z.object({
  api: ApiConfigSchema.default({}),
  security: SecurityConfigSchema.optional(),
  ui: z.record(z.unknown()).optional(),
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

// ─── ConfigStore ────────────────────────────────────────────────────────────

/**
 * 配置存储
 * 加载 project_config.json（项目级开关）和
 * **全局** config.json（全系列产品共用：LLM api.presets 等），深度合并后用 Zod 校验。
 *
 * 分工：
 * - 用户态 config.json（~/.maou 或 $MAOU_HOME，可用 $MAOU_LLM_CONFIG 覆盖路径）：
 *   LLM 配置（api.presets）等全局应用配置的**唯一权威源**，所有 maou 系列产品共用。
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
    const projectRaw = readJsonFile(this.projectPath)
    // 深合并：project 覆盖 user。
    // 由于 project_config.json 不再放 api 段（见类注释），api 配置实际只来自 config.json，
    // 因此 config.json 是 LLM 配置（api.presets）的唯一权威源——改它就生效，无矛盾。
    const merged = deepMerge(userRaw, projectRaw)

    // 配置文件使用 snake_case，schema 使用 camelCase
    const normalized = normalizeKeys(merged)
    const result = AppConfigSchema.safeParse(normalized)
    if (result.success) {
      return result.data
    }
    // 校验失败时用默认值，打印警告
    console.warn('[ConfigStore] 配置校验失败，使用默认值:', result.error.flatten())
    return AppConfigSchema.parse({})
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
    const idx = index ?? this.config.api.defaultPreset
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
    mkdirSync(dirname(this.userPath), { recursive: true })
    writeFileSync(this.userPath, JSON.stringify(data, null, 2), 'utf-8')
    try {
      chmodSync(this.userPath, 0o600)
    } catch {
      /* Windows 等可能不支持 */
    }
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
