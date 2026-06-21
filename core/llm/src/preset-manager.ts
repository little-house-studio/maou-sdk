/**
 * PresetManager SDK — API 预设管理
 *
 * 管理 API 预设的增删切换、环境变量注入、连接测试与模型列表获取。
 * 预设数据来源：构造参数指定的 JSON 文件 / core/llm/presets/ 目录扫描。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { APIPreset } from './adapters/types.js'

/** 预设配置（面向用户的完整字段） */
export interface PresetConfig {
  name: string
  model: string
  url: string
  key?: string
  protocol?: string
  maxTokens?: number
  stream?: boolean
  supportsVision?: boolean
  supportsReasoning?: boolean
  nativeToolCalling?: boolean
  nativeStructuredOutput?: boolean
  structuredOutputMode?: 'json_object' | 'json_schema'
  reasoningParams?: Record<string, unknown>
  pricing?: {
    inputPrice: number
    outputPrice: number
    cacheHitPrice: number
    currency?: string
  }
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  ok: boolean
  model: string
  latencyMs: number
  error?: string
}

/** 模型列表项 */
export interface ModelEntry {
  id: string
  ownedBy: string
}

/** PresetManager 构造选项 */
export interface PresetManagerOptions {
  /** 自定义预设配置文件路径 */
  configPath?: string
  /** 预设 JSON 文件所在目录（扫描所有 .json 文件） */
  presetsDir?: string
}

/** 持久化数据格式 */
interface PresetStoreData {
  activeName: string
  presets: PresetConfig[]
}

/** 环境变量 → 协议/名称 映射表 */
const ENV_KEY_MAP: Array<{ env: string; matchProtocol?: string; matchNamePrefix?: string }> = [
  { env: 'OPENAI_API_KEY', matchProtocol: 'openai' },
  { env: 'ANTHROPIC_API_KEY', matchProtocol: 'anthropic' },
  { env: 'DEEPSEEK_API_KEY', matchNamePrefix: 'deepseek' },
]

export class PresetManager {
  private presets: Map<string, PresetConfig> = new Map()
  private activeName: string = ''
  private configPath: string

  constructor(options?: PresetManagerOptions) {
    this.configPath = options?.configPath ?? join(process.cwd(), 'preset-config.json')

    // 从指定目录加载 JSON 预设文件
    if (options?.presetsDir) {
      this.loadFromDir(options.presetsDir)
    }

    // 如果有持久化配置文件，加载覆盖
    if (!options?.configPath && existsSync(this.configPath)) {
      this.load()
    } else if (options?.configPath && existsSync(options.configPath)) {
      this.load()
    }

    // 如果 presetsDir 下的预设比持久化文件更全，做一次合并补充
    if (options?.presetsDir) {
      this.loadFromDir(options.presetsDir)
    }

    // 从环境变量注入 API Key
    this.loadEnvKeys()

    // 没有活跃预设时自动选择第一个
    if (!this.activeName && this.presets.size > 0) {
      this.activeName = this.presets.keys().next().value!
    }
  }

  // ── 从目录扫描 JSON 预设文件 ──

  private loadFromDir(dir: string): void {
    if (!existsSync(dir)) return
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8')
        const data = JSON.parse(raw) as Record<string, unknown>
        const config = this.normalizePreset(data)
        if (config.name && !this.presets.has(config.name)) {
          this.presets.set(config.name, config)
        }
      } catch {
        // 跳过无法解析的文件
      }
    }
  }

  // ── 从环境变量注入 Key ──

  private loadEnvKeys(): void {
    for (const { env, matchProtocol, matchNamePrefix } of ENV_KEY_MAP) {
      const key = process.env[env]
      if (!key) continue

      for (const [name, config] of this.presets) {
        const protocolMatch = matchProtocol && config.protocol === matchProtocol
        const nameMatch = matchNamePrefix && name.toLowerCase().startsWith(matchNamePrefix.toLowerCase())
        if ((protocolMatch || nameMatch) && !config.key) {
          config.key = key
        }
      }
    }
  }

  // ── 将原始 JSON 对象标准化为 PresetConfig ──

  private normalizePreset(raw: Record<string, unknown>): PresetConfig {
    return {
      name: String(raw.name ?? ''),
      model: String(raw.model ?? ''),
      url: String(raw.url ?? ''),
      key: raw.key ? String(raw.key) : undefined,
      protocol: raw.protocol ? String(raw.protocol) : undefined,
      maxTokens: typeof raw.maxTokens === 'number' ? raw.maxTokens : undefined,
      stream: typeof raw.stream === 'boolean' ? raw.stream : undefined,
      supportsVision: typeof raw.supportsVision === 'boolean' ? raw.supportsVision : undefined,
      supportsReasoning: typeof raw.supportsReasoning === 'boolean' ? raw.supportsReasoning : undefined,
      nativeToolCalling: typeof raw.nativeToolCalling === 'boolean' ? raw.nativeToolCalling : undefined,
      nativeStructuredOutput: typeof raw.nativeStructuredOutput === 'boolean' ? raw.nativeStructuredOutput : undefined,
      structuredOutputMode: raw.structuredOutputMode === 'json_object' || raw.structuredOutputMode === 'json_schema'
        ? raw.structuredOutputMode
        : undefined,
      reasoningParams: typeof raw.reasoningParams === 'object' && raw.reasoningParams !== null
        ? raw.reasoningParams as Record<string, unknown>
        : undefined,
      pricing: typeof raw.pricing === 'object' && raw.pricing !== null
        ? raw.pricing as PresetConfig['pricing']
        : undefined,
    }
  }

  // ── 添加配置 ──

  add(config: PresetConfig): void {
    this.presets.set(config.name, config)
    if (!this.activeName) {
      this.activeName = config.name
    }
    this.save()
  }

  // ── 删除配置 ──

  remove(name: string): boolean {
    if (!this.presets.has(name)) return false
    this.presets.delete(name)

    // 如果删除的是当前活跃预设，切换到第一个
    if (this.activeName === name) {
      this.activeName = this.presets.size > 0 ? this.presets.keys().next().value! : ''
    }

    this.save()
    return true
  }

  // ── 切换配置 ──

  switchTo(name: string): boolean {
    if (!this.presets.has(name)) return false
    this.activeName = name
    this.save()
    return true
  }

  // ── 获取当前活跃预设 ──

  getActive(): PresetConfig | null {
    if (!this.activeName) return null
    return this.presets.get(this.activeName) ?? null
  }

  // ── 获取所有预设 ──

  list(): PresetConfig[] {
    return Array.from(this.presets.values())
  }

  // ── 获取指定预设 ──

  get(name: string): PresetConfig | null {
    return this.presets.get(name) ?? null
  }

  // ── 获取 API 模型列表 ──

  async fetchModels(preset?: PresetConfig): Promise<ModelEntry[]> {
    const target = preset ?? this.getActive()
    if (!target) throw new Error('没有可用的预设配置')

    // 从 URL 中提取 base URL
    const baseUrl = target.url
      .replace(/\/chat\/completions$/, '')
      .replace(/\/v1\/messages$/, '')
      .replace(/\/v1\/responses$/, '')
      .replace(/\/v1$/, '')
      .replace(/\/+$/, '')
    const modelsUrl = `${baseUrl}/v1/models`

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (target.key) {
      headers['Authorization'] = `Bearer ${target.key}`
    }

    try {
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`获取模型列表失败 (${response.status}): ${detail}`)
      }

      const data = await response.json() as Record<string, unknown>

      // 标准 OpenAI 格式: { data: [{ id, owned_by }] }
      if (Array.isArray(data.data)) {
        return (data.data as Array<Record<string, unknown>>).map(item => ({
          id: String(item.id ?? ''),
          ownedBy: String(item.owned_by ?? item.ownedBy ?? ''),
        }))
      }

      // 部分供应商: { models: [{ id, ... }] }
      if (Array.isArray(data.models)) {
        return (data.models as Array<Record<string, unknown>>).map(item => ({
          id: String(item.id ?? item.name ?? ''),
          ownedBy: String(item.owned_by ?? item.ownedBy ?? ''),
        }))
      }

      return []
    } catch (err) {
      throw new Error(`获取模型列表失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── 测试连接 ──

  async testConnection(preset?: PresetConfig): Promise<ConnectionTestResult> {
    const target = preset ?? this.getActive()
    if (!target) {
      return { ok: false, model: '', latencyMs: 0, error: '没有可用的预设配置' }
    }

    const startedAt = Date.now()

    try {
      // 构建最小化请求
      const protocol = (target.protocol ?? 'openai').toLowerCase()
      const url = target.url
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (target.key) {
        headers['Authorization'] = `Bearer ${target.key}`
      }
      if (protocol === 'anthropic') {
        headers['x-api-version'] = '2023-06-01'
        // Anthropic 使用不同的 header
        if (target.key) {
          headers['x-api-key'] = target.key
          delete headers['Authorization']
        }
      }

      const payload = this.buildTestPayload(target, protocol)

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })

      const latencyMs = Date.now() - startedAt

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        return { ok: false, model: target.model, latencyMs, error: `HTTP ${response.status}: ${detail}` }
      }

      return { ok: true, model: target.model, latencyMs }
    } catch (err) {
      const latencyMs = Date.now() - startedAt
      return { ok: false, model: target.model, latencyMs, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 构建连接测试的最小 payload */
  private buildTestPayload(preset: PresetConfig, protocol: string): Record<string, unknown> {
    if (protocol === 'anthropic') {
      return {
        model: preset.model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
      }
    }

    // openai / responses 通用
    return {
      model: preset.model,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    }
  }

  // ── 转为 APIPreset（供 LLMClient 使用）──

  toAPIPreset(config?: PresetConfig): APIPreset {
    const source = config ?? this.getActive()
    if (!source) throw new Error('没有可用的预设配置')

    const preset: APIPreset = {
      model: source.model,
      url: source.url,
    }

    if (source.name) preset.name = source.name
    if (source.key) preset.key = source.key
    if (source.protocol) preset.protocol = source.protocol
    if (source.maxTokens !== undefined) preset.maxTokens = source.maxTokens
    if (source.supportsVision !== undefined) preset.supportsVision = source.supportsVision
    if (source.reasoningParams) preset.reasoning_params = source.reasoningParams

    return preset
  }

  // ── 持久化 ──

  private save(): void {
    const data: PresetStoreData = {
      activeName: this.activeName,
      presets: this.list(),
    }
    const dir = dirname(this.configPath)
    mkdirSync(dir, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  private load(): void {
    try {
      const raw = readFileSync(this.configPath, 'utf-8')
      const data = JSON.parse(raw) as PresetStoreData

      if (Array.isArray(data.presets)) {
        for (const item of data.presets) {
          const config = this.normalizePreset(item as unknown as Record<string, unknown>)
          if (config.name) {
            this.presets.set(config.name, config)
          }
        }
      }

      if (data.activeName && this.presets.has(data.activeName)) {
        this.activeName = data.activeName
      }
    } catch {
      // 文件不存在或解析失败时静默处理
    }
  }
}
