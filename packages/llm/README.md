# @little-house-studio/llm

> 统一多厂商 LLM SDK —— 一套 API 打通 OpenAI / Anthropic / Google / Mistral / Bedrock / Azure / Cloudflare / Vertex / Codex / GitHub Copilot，以及任意 OpenAI 兼容端点。

特性：流式与非流式 · 原生工具调用 · **结构化 JSON 输出（带修复/容错）** · 思考/推理解析 · 多模态 · 成本与 token 统计 · 内置 `agentLoop` · 订阅 OAuth 登录 · 图片生成 · 跨厂商对话交接 · 模型注册表（含定价）· 类型安全工具（TypeBox）· Faux/Mock 测试 · 浏览器与 Node 双跑。

> 📦 **包名已设为 `@little-house-studio/llm`**。发布前确认一件事：你在 npm 注册的**用户名**（或你创建的**组织名**）必须就是 `little-house-studio`——scope 前缀必须等于你拥有的用户名/组织名。要换名字只需改 `package.json` 的 `name` 字段。

---

## 安装

```bash
npm install @little-house-studio/llm
```

只有 2 个必需依赖（`@sinclair/typebox`、`partial-json`）。
Bedrock 签名（`@smithy/*`、`@aws-sdk/credential-provider-node`）和 HTTP 代理（`undici`）是**可选依赖**，只有用到对应功能时才需要。

## 快速开始

```ts
import { ChatSession, modelToAPIPreset } from "@little-house-studio/llm";

// 从内置模型目录拿 preset（key 自动读环境变量 ANTHROPIC_API_KEY）
const preset = modelToAPIPreset("anthropic", "claude-sonnet-4-5");
const session = new ChatSession({ preset });

// 流式输出
for await (const ev of session.sendStream("用一句话介绍你自己")) {
  if (ev.type === "delta") process.stdout.write(ev.delta ?? "");
}
```

或手动配置任意 OpenAI 兼容端点：

```ts
const session = new ChatSession({
  preset: {
    model: "deepseek-chat",
    url: "https://api.deepseek.com/v1/chat/completions",
    protocol: "openai",
    key: process.env.DEEPSEEK_API_KEY,
  },
});
const resp = await session.send("你好");
console.log(resp.content, resp.usage);
```

## agentLoop（工具调用闭环）

```ts
import { agentLoop, defineTool, Type } from "@little-house-studio/llm";

const add = defineTool({
  name: "add",
  description: "两数相加",
  parameters: Type.Object({ a: Type.Number(), b: Type.Number() }), // 编译期类型 + 运行期校验
  execute: ({ a, b }) => a + b,
});

for await (const ev of agentLoop({ preset, tools: [add], prompt: "3+4 等于几？用 add 工具" })) {
  if (ev.type === "text") process.stdout.write(ev.delta);
  if (ev.type === "tool_result") console.log("\n[工具结果]", ev.result);
}
```

## 结构化 JSON 输出

```ts
session.setJsonSchema({ schema: JSON.stringify({
  type: "object",
  properties: { city: { type: "string" }, temp: { type: "number" } },
  required: ["city", "temp"],
}) });
const resp = await session.send("北京现在多少度？返回 JSON");
// 内置 JSON 提取 / 修复 / 缺失闭合符推断，尽力保证拿到合法 JSON
```

## 模型注册表（内置目录 + 定价）

```ts
import { getProviders, getModels, getModel } from "@little-house-studio/llm/registry";

getProviders();                         // 所有厂商
getModels("openai");                    // 某厂商全部模型（带能力位）
getModel("anthropic", "claude-opus-4-1")?.pricing; // { input: 15, output: 75, ... }
```

## 订阅 OAuth 登录（免 API key）

```ts
import { loginAnthropic, applyOAuthToPreset } from "@little-house-studio/llm/oauth";

const { url, complete } = loginAnthropic();
console.log("打开并授权：", url);
await complete(codeFromUser);                 // 保存令牌
const preset = await applyOAuthToPreset(basePreset, "anthropic"); // 注入 token
```

支持 `loginAnthropic`（Claude Pro/Max）、`loginOpenAICodex`（ChatGPT）、
`loginGitHubCopilot`（设备码）、`loginGeminiCli`（Google）。

## 图片生成

```ts
import { generateImages } from "@little-house-studio/llm/image";
const { images } = await generateImages({ model: "gpt-image-1", prompt: "赛博朋克猫" });
```

## 测试用 Faux Provider（不联网）

```ts
import { registerFauxProvider, fauxAssistantMessage } from "@little-house-studio/llm";
registerFauxProvider({ responses: [fauxAssistantMessage("你好～")] });
// preset.protocol 设为 "faux" 即返回预设响应，单测无需真实 API
```

## 进阶：注入自定义 fetch（代理 / WebSocket / 浏览器）

```ts
import { LLMClient } from "@little-house-studio/llm";
import { createProxyFetch } from "@little-house-studio/llm/proxy";       // 读 http_proxy/https_proxy
import { createWebSocketFetch } from "@little-house-studio/llm/transport";

new LLMClient({ fetchImpl: createProxyFetch() });          // 走代理
new LLMClient({ onPayload: ctx => { /* 发送前改 headers/body */ } });
```

## 子路径一览

| 子路径 | 内容 |
|---|---|
| `@little-house-studio/llm` | 主入口：ChatSession、LLMClient、tools、registry、handoff、reasoning、faux… |
| `@little-house-studio/llm/oauth` | 订阅 OAuth 登录 |
| `@little-house-studio/llm/registry` | 模型目录 + 定价 |
| `@little-house-studio/llm/image` | 图片生成 |
| `@little-house-studio/llm/tools` | TypeBox 类型安全工具 |
| `@little-house-studio/llm/proxy` | HTTP 代理 fetch（Node-only，依赖 undici） |
| `@little-house-studio/llm/transport` | WebSocket 传输 |
| `@little-house-studio/llm/stealth` | 工具名伪装 |

## 浏览器

主入口 `@little-house-studio/llm` 不静态依赖任何 node-only 模块（AWS/smithy 为按需动态加载），可直接打包进浏览器。
注意：`@little-house-studio/llm/oauth`（用到 `node:fs`）与 `@little-house-studio/llm/proxy`（用到 `undici`）是 Node 专用，浏览器场景请勿引入；Bedrock 也无法在浏览器使用。

> 安全提示：浏览器里直连 LLM 会暴露 API key，生产环境请走你自己的后端代理。

## License

MIT
