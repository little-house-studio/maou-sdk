/**
 * StreamJsonAccumulator — 流式 JSON 字段提取器
 *
 * 在 LLM 流式输出 JSON 时，逐字段检测：
 * - 工具调用（name + parameters 流式累积）
 * - 结构化输出字段（如 response、expression、predict 等）
 * - 每个字段完成时触发回调 / 提供轮询接口
 *
 * 用法（回调风格）:
 * ```ts
 * const parser = new StreamJsonAccumulator({
 *   onField: (field) => console.log(`${field.key} = ${field.value}`),
 *   onToolCall: (tool) => console.log(`工具: ${tool.name}`),
 *   onToolProgress: (name, params) => console.log(`参数: ${JSON.stringify(params)}`),
 * })
 * for await (const delta of session.sendStream('...')) {
 *   if (delta.delta) parser.feed(delta.delta)
 * }
 * ```
 *
 * 用法（轮询风格）:
 * ```ts
 * const acc = new StreamJsonAccumulator()
 * for (const chunk of stream) {
 *   acc.feed(chunk)
 *   for (const field of acc.getNewFields()) {
 *     console.log(`字段 ${field.name} 完成:`, field.value)
 *   }
 *   const streaming = acc.getStreamingFields()
 *   for (const [name, content] of streaming) {
 *     console.log(`字段 ${name} 流式中:`, content)
 *   }
 * }
 * ```
 */

import { iterTopLevelJsonFields } from './protocol/json-scan.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/** JSON 字段信息（回调风格） */
export interface StructuredField {
  /** 字段名 */
  key: string
  /** 字段原始 JSON 值（字符串） */
  rawValue: string
  /** 解析后的值 */
  value: unknown
  /** 字段是否完整 */
  complete: boolean
}

/** 工具调用进度 */
export interface ToolCallProgress {
  /** 工具名（如 "read"、"bash"） */
  name: string
  /** 工具参数（可能不完整） */
  parameters: Record<string, unknown>
  /** 工具调用是否完整 */
  complete: boolean
  /** 原始 JSON 字符串 */
  raw: string
}

/** 已完成的字段（轮询风格） */
export interface CompletedField {
  name: string
  value: unknown
  rawValue: string
}

/** 流式字段状态（轮询风格） */
export interface StreamingField {
  name: string
  /** 到目前为止累积的字符串内容 */
  content: string
  /** 本次 feed 新增的内容 */
  delta: string
  /** 字段值是否已完成 */
  complete: boolean
}

// ─── StreamJsonAccumulator ──────────────────────────────────────────────────

export class StreamJsonAccumulator {
  private accumulated = ''
  private lastFieldSnapshot = ''
  private lastCompletedNames = new Set<string>()
  private lastFieldContents = new Map<string, string>()
  private lastToolName = ''
  private lastToolParamsSnapshot = ''

  // 回调（可选）
  private onFieldCallback?: (field: StructuredField) => void
  private onToolCallCallback?: (tool: ToolCallProgress) => void
  private onToolProgressCallback?: (progress: ToolCallProgress) => void
  private onFieldProgressCallback?: (key: string, partialValue: string, complete: boolean) => void

  constructor(options?: {
    onField?: (field: StructuredField) => void
    onToolCall?: (tool: ToolCallProgress) => void
    onToolProgress?: (progress: ToolCallProgress) => void
    onFieldProgress?: (key: string, partialValue: string, complete: boolean) => void
  }) {
    this.onFieldCallback = options?.onField
    this.onToolCallCallback = options?.onToolCall
    this.onToolProgressCallback = options?.onToolProgress
    this.onFieldProgressCallback = options?.onFieldProgress
  }

  /**
   * 喂入增量文本，更新内部状态并触发回调
   *
   * @param delta - 本次新增的文本片段
   */
  feed(delta: string): void {
    this.accumulated += delta

    // 扫描顶层 JSON 字段
    const [fields, objectComplete] = iterTopLevelJsonFields(this.accumulated)

    // 构建当前快照用于变更检测
    const currentSnapshot = fields.map(([k, v, c]) => `${k}:${c ? '1' : '0'}`).join('|')

    // 检测工具调用
    this._detectToolCall(fields)

    // 逐字段触发回调
    for (const [key, rawValue, valueComplete] of fields) {
      // 字段级进度回调
      if (this.onFieldProgressCallback) {
        this.onFieldProgressCallback(key, rawValue, valueComplete)
      }

      // 字段完成时触发 onField
      if (valueComplete && this.onFieldCallback) {
        let parsedValue: unknown
        try {
          parsedValue = JSON.parse(rawValue)
        } catch {
          parsedValue = rawValue
        }
        this.onFieldCallback({ key, rawValue, value: parsedValue, complete: true })
      }
    }

    this.lastFieldSnapshot = currentSnapshot
  }

  // ── 轮询风格 API ──────────────────────────────────────────────────────────

  /**
   * 获取自上次调用以来新完成的字段
   */
  getNewFields(): CompletedField[] {
    const [fields] = iterTopLevelJsonFields(this.accumulated)
    const result: CompletedField[] = []

    for (const [key, rawValue, complete] of fields) {
      if (!complete) continue
      if (this.lastCompletedNames.has(key)) continue

      this.lastCompletedNames.add(key)
      let value: unknown
      try {
        value = JSON.parse(rawValue)
      } catch {
        value = rawValue
      }

      result.push({ name: key, value, rawValue })
    }

    return result
  }

  /**
   * 获取所有正在流式输出的字符串字段
   * 返回 Map<fieldName, StreamingField>
   */
  getStreamingFields(): Map<string, StreamingField> {
    const [fields] = iterTopLevelJsonFields(this.accumulated)
    const result = new Map<string, StreamingField>()

    for (const [key, rawValue, complete] of fields) {
      // 只处理字符串类型的字段
      if (!rawValue.startsWith('"')) continue

      // 提取字符串内容（去掉引号）
      let content: string
      if (complete) {
        try {
          content = JSON.parse(rawValue)
        } catch {
          content = rawValue.slice(1, -1)
        }
      } else {
        // 未完成的字符串，取引号后的原始内容
        content = rawValue.slice(1)
        // 去掉可能的转义
        content = content.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }

      const lastContent = this.lastFieldContents.get(key) ?? ''
      const delta = content.slice(lastContent.length)

      if (delta || complete) {
        result.set(key, {
          name: key,
          content,
          delta,
          complete,
        })
      }
    }

    // 更新上次的内容记录
    for (const [key, field] of result) {
      this.lastFieldContents.set(key, field.content)
    }

    return result
  }

  /**
   * 检测是否包含工具调用
   * 返回工具名称（如果检测到）
   */
  detectToolCall(): { name: string; complete: boolean } | null {
    const [fields] = iterTopLevelJsonFields(this.accumulated)

    for (const [key, rawValue, complete] of fields) {
      if (key !== 'tool') continue

      // 尝试解析 tool 字段
      if (complete) {
        try {
          const toolObj = JSON.parse(rawValue)
          if (toolObj && typeof toolObj === 'object' && toolObj.name) {
            return { name: toolObj.name, complete: true }
          }
        } catch {
          // 可能是嵌套 JSON 字符串，尝试再次解析
          try {
            const inner = JSON.parse(rawValue.replace(/^"|"$/g, ''))
            if (inner && typeof inner === 'object' && inner.name) {
              return { name: inner.name, complete: true }
            }
          } catch {}
        }
      } else {
        // 未完成，尝试从部分 JSON 中提取 name
        const nameMatch = rawValue.match(/"name"\s*:\s*"([^"]*)"/)
        if (nameMatch) {
          return { name: nameMatch[1], complete: false }
        }
      }
    }

    return null
  }

  /**
   * 检测 JSON 对象是否完整
   */
  isComplete(): boolean {
    const [, complete] = iterTopLevelJsonFields(this.accumulated)
    return complete
  }

  // ── 通用查询 API ──────────────────────────────────────────────────────────

  /** 获取当前累积的完整文本 */
  getText(): string {
    return this.accumulated
  }

  /** 获取所有已检测到的顶层字段 */
  getFields(): StructuredField[] {
    const [fields] = iterTopLevelJsonFields(this.accumulated)
    return fields.map(([key, rawValue, complete]) => {
      let value: unknown
      if (complete) {
        try { value = JSON.parse(rawValue) } catch { value = rawValue }
      }
      return { key, rawValue, value, complete }
    })
  }

  /** 获取指定字段的值（如果已完成） */
  getField<T = unknown>(key: string): T | null {
    const fields = this.getFields()
    const field = fields.find(f => f.key === key && f.complete)
    return field ? (field.value as T) : null
  }

  /** 获取指定字段的原始 JSON 字符串（可能不完整） */
  getFieldRaw(key: string): string | null {
    const fields = this.getFields()
    const field = fields.find(f => f.key === key)
    return field ? field.rawValue : null
  }

  /** 重置（用于下一轮对话） */
  reset(): void {
    this.accumulated = ''
    this.lastFieldSnapshot = ''
    this.lastCompletedNames.clear()
    this.lastFieldContents.clear()
    this.lastToolName = ''
    this.lastToolParamsSnapshot = ''
  }

  // ── 内部：检测工具调用 ──

  private _detectToolCall(fields: Array<[string, string, boolean]>): void {
    for (const [key, rawValue, valueComplete] of fields) {
      if (key !== 'tool') continue

      let toolObj: Record<string, unknown> | null = null
      try {
        const parsed = JSON.parse(rawValue)
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          toolObj = parsed as Record<string, unknown>
        }
      } catch {
        // 值不完整，尝试从原始文本解析部分信息
      }

      if (!toolObj) {
        // 尝试从原始 JSON 提取工具名和部分参数
        this._extractPartialTool(rawValue)
        continue
      }

      const name = String(toolObj.name || '')
      const parameters = (toolObj.parameters as Record<string, unknown>) || {}
      const raw = JSON.stringify(toolObj)

      // 工具名变化 → 触发 onToolCall
      if (name && name !== this.lastToolName) {
        this.lastToolName = name
        this.lastToolParamsSnapshot = ''
        if (this.onToolCallCallback) {
          this.onToolCallCallback({ name, parameters, complete: valueComplete, raw })
        }
      }

      // 参数变化 → 触发 onToolProgress
      const paramsSnapshot = JSON.stringify(parameters)
      if (name && paramsSnapshot !== this.lastToolParamsSnapshot) {
        this.lastToolParamsSnapshot = paramsSnapshot
        if (this.onToolProgressCallback) {
          this.onToolProgressCallback({ name, parameters, complete: valueComplete, raw })
        }
      }
    }
  }

  /** 从不完整的 tool JSON 中提取工具名和部分参数 */
  private _extractPartialTool(raw: string): void {
    // 尝试提取 "name": "xxx"
    const nameMatch = raw.match(/"name"\s*:\s*"([^"]*)"/)
    if (nameMatch) {
      const name = nameMatch[1]
      if (name && name !== this.lastToolName) {
        this.lastToolName = name
        if (this.onToolCallCallback) {
          this.onToolCallCallback({ name, parameters: {}, complete: false, raw })
        }
      }

      // 尝试提取已有参数
      const paramsMatch = raw.match(/"parameters"\s*:\s*(\{[^}]*\}?)/)
      if (paramsMatch) {
        try {
          const params = JSON.parse(paramsMatch[1])
          const paramsSnapshot = JSON.stringify(params)
          if (paramsSnapshot !== this.lastToolParamsSnapshot) {
            this.lastToolParamsSnapshot = paramsSnapshot
            if (this.onToolProgressCallback) {
              this.onToolProgressCallback({ name, parameters: params, complete: false, raw })
            }
          }
        } catch {
          // 参数不完整，跳过
        }
      }
    }
  }
}