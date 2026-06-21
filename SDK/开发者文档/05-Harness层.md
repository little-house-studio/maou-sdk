# Harness 层 (`harness`)

Harness 层是完整的 Agent 运行时，组合了所有核心层，是 Maou 设计哲学和产品功能的核心。

---

## 1. MaouHarness

### 导入

```ts
import { MaouHarness } from 'maou-agent/harness'
```

### 构造函数

```ts
const harness = new MaouHarness({
  // 全部可选，有合理默认值
  maouRoot: '~/.maou',
  projectRoot: process.cwd(),
  promptRoot: 'ROLE/default',
  agentRoundLimit: 50,
  loopThreshold: 10,
  contextThresholdPercent: 70,
  contextKeepRecentPercent: 25,
})
```

### runAgent() —— 运行 Agent

异步生成器，yield 每个执行步骤的事件。

```ts
const stream = harness.runAgent({ sessionId: 'abc', userMessage: '你好' })

for await (const event of stream) {
  switch (event.type) {
    case 'assistant_delta':
      process.stdout.write(event.data.delta as string)
      break
    case 'tool_call':
      console.log('调用工具:', event.data.toolName)
      break
    case 'tool_result':
      console.log('工具结果:', event.data.result)
      break
    case 'done':
      console.log('完成', event.data)
      break
  }
}
```

### 执行流程

```
1. 确保 session 存在 → 加载/创建
2. 编译 prompt（首轮）
3. Agent 循环（最大 agentRoundLimit 轮）：
   a. 从 session 历史构建消息数组
   b. 通过 ModelCaller 调用 LLM（流式）
   c. yield 每个流式事件
   d. 解析响应中的工具调用
   e. 如有工具调用：执行工具 → 追加结果 → 继续循环
   f. 如无工具调用：退出循环
4. yield done 事件
```

**自动压缩**：token 达到 `contextThresholdPercent`（默认 70%）时触发，保留 `contextKeepRecentPercent`（默认 25%）近期消息。

### 配置项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `maouRoot` | `~/.maou` | maou 数据根目录 |
| `projectRoot` | `process.cwd()` | 项目根目录 |
| `promptRoot` | `ROLE/default` | prompt 模板根目录 |
| `agentRoundLimit` | `50` | 最大轮次，0 = 无限 |
| `loopThreshold` | `10` | 循环检测阈值 |
| `contextThresholdPercent` | `70` | 触发压缩的 token 百分比 |
| `contextKeepRecentPercent` | `25` | 压缩时保留的近期消息比例 |

---

## 2. MaouClient / HubClient —— SDK 客户端

与 Hub 通信的抽象客户端，支持 HTTP 传输。

### 导入

```ts
import { HttpClient, HubClient } from 'maou-agent/harness'
// HubClient 是 HttpClient 的别名，保持向后兼容
```

### 构造函数

```ts
const client = new HttpClient('http://127.0.0.1:8098', 'my-plugin')
```

### 方法表

| 方法 | 签名 | 说明 |
|------|------|------|
| `sendMessage` | `(content?, payload?, targetDevice?, targetAgent?) => Promise<object>` | 发送消息到 Hub |
| `subscribe` | `(eventType: string, handler: (event) => void) => string` | 订阅事件 |
| `unsubscribe` | `(handler: (event) => void) => void` | 取消订阅 |
| `pollEvents` | `(since?: string) => Promise<AgentEvent[]>` | 轮询事件 |
| `health` | `() => Promise<object>` | 健康检查 |
| `listDevices` | `() => Promise<object[]>` | 设备列表 |
| `pollLoop` | `(interval: number, onEvent: (event) => void) => Promise<void>` | 阻塞式轮询（Ctrl+C 停止） |

### 使用示例

```ts
import { HttpClient } from 'maou-agent/harness'

const client = new HttpClient('http://127.0.0.1:8098', 'my-plugin')

// 发送消息
await client.sendMessage('hello', { extra: 'data' })

// 事件订阅
client.subscribe('message', (event) => {
  console.log(event.type, event.data)
})

// 轮询
const events = await client.pollEvents('last-timestamp')

// 健康检查
const status = await client.health()
console.log(status.ok ? '正常' : '异常')

// 设备列表
const devices = await client.listDevices()

// 阻塞式轮询循环（每 3 秒）
await client.pollLoop(3000, (event) => console.log(`[${event.type}]`, event.data))
```

### AgentEvent

```ts
interface AgentEvent {
  type: string
  data: Record<string, unknown>
  source: string
  timestamp: number
}
```

### 架构

```
插件 / 客户端
    ↓
ClientBase (抽象接口)
    ├── HttpClient (HTTP 实现)
    └── (未来: WebSocket, IPC 等)
    ↓
Hub (hub/)
    ├── HTTP API
    └── WebSocket
```