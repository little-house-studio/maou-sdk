# Agent 层 (`core/agent`)

---

## 1. AgentRegistry —— Agent 管理

管理 `~/.maou/agents/<name>/agent.json` 目录下的 Agent 定义。

### 导入

```ts
import { AgentRegistry, initMainAgent } from 'maou-agent/core/agent'
```

### 构造函数

```ts
const registry = new AgentRegistry({ maouRoot: '~/.maou' })
```

### 方法表

| 方法 | 签名 | 说明 |
|------|------|------|
| `get` | `(name: string) => AgentEntry \| null` | 按名称查找 |
| `save` | `(entry: AgentEntry) => void` | 保存 agent 定义 |
| `delete` | `(name: string) => boolean` | 删除 agent |
| `list` | `() => AgentEntry[]` | 列出所有 agent |
| `setActiveAgent` | `(name: string) => void` | 切换活跃 agent |
| `getActiveAgent` | `() => AgentEntry \| null` | 获取当前活跃 agent |

### 使用示例

```ts
const registry = new AgentRegistry({ maouRoot: '~/.maou' })

// 初始化主 Agent（首次运行）
initMainAgent(registry)

// CRUD
const agent: AgentEntry | null = registry.get('maou')
registry.delete('old-agent')

// 列表
const all: AgentEntry[] = registry.list()

// 切换
registry.setActiveAgent('maou')
const active = registry.getActiveAgent()
```

### AgentEntry 结构

```ts
interface AgentEntry {
  name: string
  display_name: string
  status: string
  role: string
  team: string
  parent: string
  personality: string
  scope: string
  description: string
  notes: string
  created_by: string
  created_at: string
  updated_at: string
  removal_request?: {
    reason: string
    requested_by: string
    requested_at: string
    approved: boolean | null
  }
}
```

---

## 2. AgentFactory —— Agent 工厂

从预设创建 Agent，自动生成 ROLE 目录和初始 prompt。

### 导入

```ts
import { AgentFactory } from 'maou-agent/core/agent'
```

### 构造函数

```ts
const factory = new AgentFactory({ maouRoot: '~/.maou' })
```

### 方法

```ts
// 预览创建计划（不实际执行）
const preview: AgentPreview = factory.preview({
  name: 'my-agent',
  role: '代码审查助手',
})

// 创建 agent
const result: AgentCreateResult = await factory.create({
  name: 'my-agent',
  role: '代码审查助手',
  preset: 'deepseek',
  personality: '严谨、细致',
  permission: 'full',
  team: 'default',
  description: '专注于代码质量和最佳实践的审查助手',
}, registry)
```

### 类型

```ts
interface AgentFactoryConfig {
  name: string
  role: string
  preset?: string
  race?: string
  personality?: string
  permission?: string
  team?: string
  description?: string
  notes?: string
  scope?: string
  customSoul?: string
  customTools?: string[] | null
}

interface AgentCreateResult {
  success: boolean
  agentName: string
  roleDir: string
  filesCreated: string[]
  message: string
}

interface AgentPreview {
  name: string
  role: string
  preset: string
  race: string
  personality: string
  permission: string
  team: string
  description: string
  scope: string
  roleDir: string
  filesToCreate: string[]
}
```

---

## 3. PromptCompiler —— 提示词编译器

递归解析 `{{file.md}}` 包含指令，输出最终 system prompt。

### 导入

```ts
import { PromptCompiler } from 'maou-agent/core/agent'
```

### 构造函数

```ts
const compiler = new PromptCompiler({
  promptRoot: 'ROLE/default',      // prompt 根目录
  entrypoint: 'SYSTEM.md',         // 入口文件，默认 SYSTEM.md
  maxDepth: 10,                    // 最大递归深度
  maxIterationsPerLevel: 100,      // 每层最大迭代
})
```

### 方法

```ts
// 编译完整 prompt
const result = compiler.compile()
// result.prompt — 完整 system prompt 字符串
// result.userPrompt — USER.md 内容
// result.includes — 包含的文件列表

// 运行时更新配置
compiler.configure('ROLE/custom', 'CUSTOM.md')
```

**支持的语法**：
- `{{file.md}}` — 递归包含另一个文件（最大深度 10，自动检测循环引用）
- `{{>>script.py}}` — 执行脚本并插入输出（沙箱执行）

---

## 4. TokenTracker —— Token 用量追踪

分钟级精度记录 token 消耗与费用。

### 导入

```ts
import { TokenTracker } from 'maou-agent/core/agent'
```

### 构造函数

```ts
const tracker = new TokenTracker({ logDir: '~/.maou/logs' })
```

### 方法

```ts
// 记录 token 消耗
tracker.record({
  input_tokens: 1200,
  output_tokens: 300,
  cache_hit_tokens: 500,
  model: 'deepseek-chat',
  pricing: {
    inputPrice: 0.27,
    outputPrice: 1.10,
    cacheHitPrice: 0.07,
    currency: 'CNY',
  },
})

// 获取当日摘要
const summary: DailySummary = tracker.getDailySummary('2026-06-10')
// summary.totalInput — 总输入 token
// summary.totalOutput — 总输出 token
// summary.totalCost — 总费用
// summary.records — 每分钟详细记录
```

### 类型

```ts
interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
  cache_hit_tokens?: number
  cache_read_input_tokens?: number
}

interface PricingInfo {
  inputPrice: number
  outputPrice: number
  cacheHitPrice: number
  currency: string
}

interface TokenRecord {
  minute: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_hit_tokens: number
  effective_input_tokens: number
  cost: number
}

interface DailySummary {
  totalInput: number
  totalOutput: number
  totalCost: number
  records: TokenRecord[]
}
```