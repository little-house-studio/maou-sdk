# LLM 层 (`core/llm`)

LLM 层是最底层的 API 封装。可以脱离 Agent 系统独立使用，快速搭建一个 ChatGPT 对话应用。

---

## 1. ChatSession —— 核心对话类

最推荐的高层入口，内部组合 `LLMClient` + `ModelCaller`，对开发者屏蔽协议细节。

### 导入

```ts
import { ChatSession, PresetManager } from 'maou-agent/core/llm'
```

### 构造函数

```ts
const chat = new ChatSession({
  preset: APIPreset,      // 必填，模型预设
  maxRetries?: number,    // 最大重试次数，默认 3
  loopThreshold?: number, // 循环检测阈值，默认 10
})
```

### 方法表

| 方法 | 签名 | 说明 |
|------|------|------|
| `send` | `(text: string, options?: { attachments?: Attachment[] }) => Promise<ChatResponse>` | 非流式发送消息（内含防傻瓜校验） |
| `sendStream` | `(text: string, options?: { attachments?: Attachment[] }) => AsyncGenerator<ChatDelta>` | 流式发送消息（内含防傻瓜校验） |
| `on` | `(event: LLMEventType, handler: Function) => this` | 订阅事件 |
| `off` | `(event: LLMEventType, handler: Function) => this` | 取消订阅 |
| `once` | `(event: LLMEventType, handler: Function) => this` | 单次订阅 |
| `abort` | `() => void` | 中断当前请求（真正中止底层 fetch） |
| `setReasoning` | `(level: 'off'\|'low'\|'medium'\|'high') => void` | 设置思考深度 |
| `setTools` | `(schemas: Record<string, unknown>[]) => void` | 设置原生工具 schema（模型可主动调用工具） |
| `clearTools` | `() => void` | 清除工具 schema |
| `setJsonSchema` | `(schema: Record<string, unknown>) => void` | 设置结构化输出 schema（强制 JSON 输出） |
| `clearJsonSchema` | `() => void` | 清除结构化输出设置 |
| `getTotalUsage` | `() => { input, output, cacheHit, total, cost: CostBreakdown \| null }` | 累计 token 用量 + 成本 |
| `getHistory` | `() => ChatMessage[]` | 获取完整对话历史 |
| `clearHistory` | `() => void` | 清空对话历史 |
| `getPreset` | `() => APIPreset` | 获取当前使用的预设 |
| `setPreset` | `(preset: APIPreset) => void` | 运行时切换预设 |
| `buildRequest` | `(text: string) => { url, headers, body }` | 预览请求（不发网络，调试用） |

### 核心类型

```ts
interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: Attachment[]
  toolCalls?: LLMToolCall[]
  usage?: LLMUsage
  timestamp: number
}

interface ChatResponse {
  content: string
  toolCalls: LLMToolCall[]
  usage: LLMUsage | null
  rawResponse: string
  message: ChatMessage
}

interface ChatDelta {
  type: 'delta' | 'thinking' | 'thinking_start' | 'thinking_end'
       | 'tool_call' | 'field_complete' | 'field_streaming' | 'error'
  content?: string        // 累积到当前的完整文本
  delta?: string          // 本次 chunk 新增字符
  thinking?: string       // 思考增量
  thinkingContent?: string // 累积思考内容
  toolCall?: LLMToolCall
  toolName?: string       // 流式检测到的工具名（可能不完整）
  toolComplete?: boolean
  fieldName?: string      // 结构化输出：完成的字段名
  fieldValue?: unknown    // 结构化输出：字段值
  fieldContent?: string   // 结构化输出：流式内容
  fieldDelta?: string     // 结构化输出：新增字符
  finishReason?: string
  usage?: LLMUsage
  error?: string
}

interface Attachment {
  type: 'image' | 'video' | 'audio' | 'document'
  data: string        // base64
  mimeType: string    // e.g. "image/png"
  name?: string
}
```

### 事件类型

```ts
type LLMEventType =
  | 'send'           // 发送消息
  | 'receive'        // 完整响应
  | 'first_token'    // 首字输出
  | 'thinking_start' // 推理开始
  | 'thinking_end'   // 推理结束
  | 'output_start'   // 输出开始
  | 'output_end'     // 输出结束
  | 'parse_error'    // 解析错误
  | 'delta'          // 每个流式增量
  | 'error'          // 错误
  | 'abort'          // 中断
```

### 示例

```ts
import { ChatSession } from 'maou-agent/core/llm'

const chat = new ChatSession({ preset: deepseekPreset })

// 非流式
const resp = await chat.send('你好，介绍一下自己')
console.log(resp.content, resp.usage)

// 流式
for await (const delta of chat.sendStream('写一首诗')) {
  process.stdout.write(delta.delta ?? '')
}

// 中断
chat.abort()
```

### 多模态附件

通过 `send` / `sendStream` 的 `options.attachments` 发送图片、音频、文档。`Attachment.data` 是 base64 字符串（不含 `data:` 前缀）。

```ts
import { readFileSync } from 'node:fs'

// 发送图片（需要支持 vision 的模型，如 gpt-4o）
const imageBase64 = readFileSync('cat.png').toString('base64')
await chat.send('描述这张图', {
  attachments: [{
    type: 'image',
    data: imageBase64,
    mimeType: 'image/png',
    name: 'cat.png',
  }],
})

// 发送音频（OpenAI gpt-4o-audio 支持）
const audioBase64 = readFileSync('speech.mp3').toString('base64')
await chat.send('这段音频说了什么', {
  attachments: [{
    type: 'audio',
    data: audioBase64,
    mimeType: 'audio/mp3',
    name: 'speech.mp3',
  }],
})

// 发送文档（Anthropic 支持 PDF 等）
const pdfBase64 = readFileSync('report.pdf').toString('base64')
await chat.send('总结这份报告', {
  attachments: [{
    type: 'document',
    data: pdfBase64,
    mimeType: 'application/pdf',
    name: 'report.pdf',
  }],
})
```

附件类型行为：

| type | OpenAI 协议 | Anthropic 协议 | 说明 |
|------|-------------|----------------|------|
| `image` | `image_url` | `image` source | 所有支持 vision 的模型可用 |
| `audio` | `input_audio` | 文本描述占位 | OpenAI gpt-4o-audio 支持；Anthropic 暂不支持音频输入 |
| `document` | `image_url` | `document` source | Anthropic 支持 PDF；OpenAI 以 image_url 尝试 |
| `video` | 文本描述占位 | 文本描述占位 | 主流厂商不直接支持二进制视频，建议外部抽帧转 image |

### 防傻瓜校验（Guardrails）

`send` / `sendStream` 在发送前自动做能力校验，避免用户踩坑：

| 场景 | 行为 |
|------|------|
| preset 缺 url / model / key | **抛错**（明确提示缺什么） |
| 消息内容为空（text 和 attachments 都没有） | **抛错** |
| 附件 data 不是合法 base64 | **抛错** |
| 附件 type 未知（非 image/video/audio/document） | **warn + 忽略该附件** |
| 模型 `supportsVision: false` 但发了图片 | **warn + 图片转文本描述**（不阻断发送） |
| 模型 `supportsReasoning: false` 但设了 thinking | **warn + 强制关 reasoning** |
| 模型 `nativeToolCalling: false` 但传了 tools | **warn + 丢弃 tools** |

本地模型（如 ollama，url 含 `localhost`）不需要 key，校验自动放行。

### 原生工具调用

```ts
// 注册工具 schema（模型可主动发起工具调用）
chat.setTools([
  {
    name: 'search',
    description: '搜索互联网',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query'],
    },
  },
])

// 发送后，模型可能返回 toolCalls
const resp = await chat.send('帮我搜索今天的天气')
if (resp.toolCalls.length > 0) {
  for (const tc of resp.toolCalls) {
    console.log(`工具: ${tc.name}, 参数: ${JSON.stringify(tc.parameters)}`)
    // 执行工具 → 把结果作为 tool 消息追加 → 继续 send
  }
}

// 清除工具
chat.clearTools()
```

### 结构化输出

```ts
// 强制模型输出符合 JSON Schema 的结构化数据
chat.setJsonSchema({
  schema: JSON.stringify({
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
    },
    required: ['name', 'age'],
  }),
})

const resp = await chat.send('生成一个虚拟人物')
const person = JSON.parse(resp.content)  // { name: "...", age: 42 }

chat.clearJsonSchema()  // 恢复自由文本输出
```

### 用量与成本

```ts
// 累计 token 用量 + 成本
const usage = chat.getTotalUsage()
console.log(usage)
// {
//   input: 1234,        // 输入 token 累计
//   output: 567,        // 输出 token 累计
//   cacheHit: 890,      // 缓存命中 token 累计
//   total: 1801,        // 总 token
//   cost: {             // 成本（需 preset 配置 pricing）
//     inputCost: 0.0185,
//     outputCost: 0.034,
//     cacheSavings: -0.012,
//     totalCost: 0.0405,
//     currency: 'USD'
//   }
// }
```

成本计算需要 preset 配置 `pricing` 字段：

```ts
const preset = {
  // ... 其他字段
  pricing: {
    inputPrice: 15,     // 每百万输入 token 价格（美元）
    outputPrice: 60,    // 每百万输出 token 价格
    cacheHitPrice: 1.5, // 每百万缓存命中 token 价格（可选）
    currency: 'USD',    // 可选，默认 USD
  },
}
```

### 预览请求（不发网络）

```ts
// 调试用：查看当前 preset + 工具/JSON 设置下，请求会发什么
const req = chat.buildRequest('测试消息')
console.log(req)
// { url: 'https://api.openai.com/v1/chat/completions',
//   headers: { 'Content-Type': 'application/json', ... },
//   body: '{"model":"gpt-4o","messages":[...]}' }
```

---

## 2. PresetManager —— 预设管理

管理多个 LLM 预设（API key、模型名、地址协议等），支持增删切换、环境变量注入。

### 导入

```ts
import { PresetManager } from 'maou-agent/core/llm'
```

### 构造函数

```ts
const mgr = new PresetManager({
  configPath?: string,  // 持久化配置文件路径，默认 ./preset-config.json
  presetsDir?: string,  // 要扫描的 JSON 预设文件目录
})
```

### 方法表

| 方法 | 签名 | 说明 |
|------|------|------|
| `add` | `(config: PresetConfig) => void` | 添加预设并持久化 |
| `remove` | `(name: string) => boolean` | 删除预设 |
| `switchTo` | `(name: string) => boolean` | 切换当前活跃预设 |
| `getActive` | `() => PresetConfig \| null` | 获取当前活跃预设 |
| `list` | `() => PresetConfig[]` | 列出全部预设 |
| `get` | `(name: string) => PresetConfig \| null` | 按名称查找 |
| `fetchModels` | `(preset?: PresetConfig) => Promise<ModelEntry[]>` | 获取可用模型列表 |
| `testConnection` | `(preset?: PresetConfig) => Promise<ConnectionTestResult>` | 测试 API 连接延迟 |
| `toAPIPreset` | `(config?: PresetConfig) => APIPreset` | 转换为 APIPreset 格式 |

### PresetConfig 结构

```ts
interface PresetConfig {
  name: string            // 预设名
  model: string           // 模型 ID
  url: string             // API 地址
  key?: string            // API Key
  protocol?: string       // 'openai' | 'anthropic' | 'responses'
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
```

### 环境变量自动注入

| 环境变量 | 匹配规则 |
|----------|----------|
| `OPENAI_API_KEY` | `protocol: 'openai'` 的预设 |
| `ANTHROPIC_API_KEY` | `protocol: 'anthropic'` 的预设 |
| `DEEPSEEK_API_KEY` | 名称含 `deepseek` 的预设 |

---

## 3. LLMClient —— 底层 HTTP 调用

直接控制 HTTP 请求，带指数退避重试（最多 8 次）和 429 限流处理。

```ts
import { LLMClient } from 'maou-agent/core/llm'

const client = new LLMClient()

// 流式调用
const stream = client.chatStream({ preset, messages, jsonSettings, toolSchemas, nativeToolCalling })
for await (const delta of stream) {
  console.log(delta.delta)
}
const result = await stream // ModelResponse

// 非流式调用
const resp: ModelResponse = await client.chat({ preset, messages, jsonSettings, toolSchemas, nativeToolCalling })
```

### ModelResponse 字段

```ts
interface ModelResponse {
  content: string
  rawEvents: string[]
  contentType: string
  finishReason: string | null
  httpStatus: number
  rawEventCount: number
  reasoningFallbackUsed: boolean
  firstOutputSeconds: number | null
  requestId: string | null
  protocol: string
  toolCalls: LLMToolCall[]
  usage: LLMUsage | null
  rawPayload: Record<string, unknown>
}
```

---

## 4. ModelCaller —— 调用管道

在 LLMClient 之上包装格式化、循环检测、JSON 校验与自动重试。

```ts
import { ModelCaller } from 'maou-agent/core/llm'
```

### 构造函数

```ts
const caller = new ModelCaller({
  client: LLMClient,
  emitEvent: (type, data) => CallerStreamEvent,
  emitLog: (level, msg) => CallerStreamEvent,
  maxRetries?: number,    // 默认 3
  loopThreshold?: number, // 循环检测阈值，默认 10
})
```

### 方法

```ts
// 流式调用 —— AsyncGenerator<CallerStreamEvent, ModelCallResult>
const stream = caller.callStream({
  sessionId: string
  roundIndex: number
  preset: APIPreset
  messages: Record<string, unknown>[]
  autoFormat: boolean
  jsonSettings: Record<string, unknown> | null
  stream: boolean
  nativeToolCalling?: boolean
})

// 非流式调用
const result: ModelCallResult = await caller.callOnce({ ... })
```

### CallerStreamEvent

```ts
interface CallerStreamEvent {
  type: string                           // 'assistant_delta' | 'tool_pending' | 'model.error' | ...
  data: Record<string, unknown>
}
```

### ModelCallResult

```ts
interface ModelCallResult {
  rawResponse: string
  content: string
  retryIndex: number
  validationError: string
  attemptDiagnostics: Record<string, unknown>[]
  nativeToolCalls: LLMToolCall[]
  usage: LLMUsage | null
  rawRequest: Record<string, unknown> | null
  rawSSEEvents: string[]
}
```

---

## 5. LLM POST 日志系统

每次 LLM HTTP 调用自动记录标准化日志，用于调试、成本分析和性能监控。

### 架构

```
LLMClient._emitLog()
  → normalizePostLogRecord()  // 标准化为 LLMPostLogRecord
    → setPostLogger callback  // Runtime 注入的回调
      → SessionStore.appendRawEntry()  // 写入 JSONL
```

- **单日志管线**：只写 `event: "llm.post"` 格式（标准化、截断 body）
- **存储位置**：`~/.maou/agents/<agentName>/raw/<sessionId>.raw.jsonl`
- **轮转策略**：文件超 20MB 自动轮转为 `.bak`，保留最近 5 个

### LLMPostLogRecord 结构

```ts
interface LLMPostLogRecord {
  version: 1
  event: "llm.post"
  created_at: string           // ISO 时间戳

  trace_id?: string            // 追踪 ID（OpenTelemetry 兼容）
  span_id?: string             // 跨度 ID
  session_id?: string
  agent_name?: string
  source?: string              // 调用来源（api/webhook/cli）

  round?: number               // agent 循环轮次
  retry?: number               // 重试次数
  model?: string               // 模型 ID
  protocol?: string            // openai / anthropic / responses

  request: {
    url: string
    method: string
    headers?: Record<string, string>  // Authorization 已脱敏
    body_summary?: string             // 请求体摘要（最多 2000 字符）
  }

  response: {
    raw_text: string           // 拼接后的完整响应文本
    content_type?: string
    http_status?: number | null
    is_stream_reassembled?: boolean
  }

  usage?: Record<string, unknown> | null  // token 用量
  duration_ms?: number                    // 调用耗时
  error?: string | null
  error_type?: "network" | "timeout" | "rate_limit" | "auth" | "bad_request" | "server_error" | "unknown" | null

  tool_calls_summary?: Array<{ id?: string; name?: string }>
}
```

### 错误分类

`error_type` 自动从 HTTP 状态码和错误消息中推断：

| error_type | 触发条件 |
|---|---|
| `rate_limit` | HTTP 429 或错误含 "429" / "rate limit" |
| `auth` | HTTP 401/403 或错误含 "unauthorized" |
| `bad_request` | HTTP 400/422 |
| `server_error` | HTTP 5xx |
| `timeout` | 错误含 "timeout" / "timed out" |
| `network` | 错误含 "ECONNREFUSED" / "ENOTFOUND" / "fetch failed" |
| `unknown` | 其他错误 |

### 使用方式

```ts
import { LLMClient } from 'maou-agent/core/llm'

const client = new LLMClient()

// 设置 POST 日志回调
client.setPostLogger((record) => {
  console.log(`[${record.model}] ${record.duration_ms}ms`, record.usage)
})
```

### 存储优化

- **不存原始 SSE 事件**：只存拼接后的 `raw_text`，节省 ~60-70% 存储
- **请求体截断**：`body_summary` 最多 2000 字符
- **自动轮转清理**：`.bak` 文件保留最近 5 个，自动删除旧的

### 读取日志

```ts
import { SessionStore } from 'maou-agent/core/context'

const store = new SessionStore('~/.maou/sessions')

// 加载所有 POST 日志
const logs = store.loadPostLogs(sessionId)

// 按轮次加载
const roundLogs = store.loadPostLogs(sessionId, { round: 3 })

// 获取最新一条
const latest = store.getLatestPostLog(sessionId)
```

---

## 6. 三层 API 选型指引

LLM 层有三层 API，按抽象程度从高到低：

| 层 | 类 | 何时用 |
|----|----|--------|
| **高层** | `ChatSession` | **99% 场景用这个**。封装了消息历史、事件、多模态、工具调用、结构化输出、防傻瓜校验、中断、成本统计。内部自动组合 LLMClient + ModelCaller。 |
| **中层** | `ModelCaller` | 需要"每次调用独立的 round/retry 控制"、自定义循环检测阈值、或不想要消息历史管理时。直接用 `caller.callStream()`。 |
| **底层** | `LLMClient` | 需要协议级控制：自定义重试策略、原生 SSE 事件处理、多协议切换、或写自定义协议适配器时。直接用 `client.chatStream()` / `client.chat()`。 |

### ChatSession 能力一览

| 能力 | ChatSession 支持？ | 说明 |
|------|-------------------|------|
| 基本对话（send/sendStream） | ✅ | |
| 多模态附件（image/audio/document） | ✅ | 含防傻瓜校验 |
| 流式输出 + 思考内容 | ✅ | thinking_delta 事件 |
| 原生工具调用 | ✅ | `setTools()` |
| 结构化输出（JSON Schema） | ✅ | `setJsonSchema()` |
| 中断请求 | ✅ | `abort()` 真正中止 fetch |
| 思考深度控制 | ✅ | `setReasoning('off'/'low'/'medium'/'high')` |
| 成本统计 | ✅ | `getTotalUsage()` |
| 事件订阅 | ✅ | `on/off/once` |
| 预览请求 | ✅ | `buildRequest()` |
| 防傻瓜校验 | ✅ | 自动能力门控 |
| 消息历史管理 | ✅ | 自动维护 + `clearHistory()` |

### 何时绕过 ChatSession

只有以下场景需要下沉到 ModelCaller 或 LLMClient：

1. **需要 Agent 循环**（多轮工具调用 + 自动续跑）→ 用 `ModelCaller.callStream()` 配合自己的循环逻辑（harness 层的 `AgentRuntime` 就是这么做的）
2. **需要自定义 POST 日志**（如写入自己的存储）→ 用 `LLMClient.setPostLogger()`
3. **写自定义协议适配器**→ 实现 `ProtocolAdapter` 接口 + 注册到 `ProtocolGateway`
4. **需要裸 SSE 事件流**（不做任何解析）→ 用 `LLMClient.chatStream()` 的 `ModelDelta.rawEvent`