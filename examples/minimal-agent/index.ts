/**
 * 最小 Agent 示例 —— 用 maou-sdk 跑一次工具调用闭环。
 *
 * 运行（在 maou-sdk 根目录）:
 *   pnpm --filter @little-house-studio/llm build   # 先构建依赖
 *   npx tsx examples/minimal-agent/index.ts
 *
 * 不联网：用 Faux provider 模拟模型，所以任何环境都能跑。
 * 想接真实模型：把 preset 换成 modelToAPIPreset("anthropic","claude-sonnet-4-5") 即可。
 */
import {
  agentLoop,
  defineTool,
  Type,
  registerFauxProvider,
  clearFauxProviders,
  fauxAssistantMessage,
  fauxToolCall,
  type APIPreset,
} from "@little-house-studio/llm";

// 1) 定义工具（TypeBox：编译期有类型，运行期自动校验参数）
const add = defineTool({
  name: "add",
  description: "两数相加",
  parameters: Type.Object({ a: Type.Number(), b: Type.Number() }),
  execute: ({ a, b }) => a + b,
});

// 2) 模拟一个会调工具、再给答案的模型（Faux，不联网）
clearFauxProviders();
registerFauxProvider({
  model: "demo",
  responses: [
    fauxAssistantMessage(fauxToolCall("add", { a: 3, b: 4 })), // 第 1 步：模型决定调 add
    fauxAssistantMessage("3 + 4 = 7"),                          // 第 2 步：拿到结果，给最终答案
  ],
});

const preset: APIPreset = {
  model: "demo",
  url: "http://faux",
  protocol: "faux",
  key: "x",
};

// 3) 跑 agent 循环
for await (const ev of agentLoop({ preset, tools: [add], prompt: "3+4 等于几？用 add 工具" })) {
  if (ev.type === "text") process.stdout.write(ev.delta);
  if (ev.type === "tool_call") console.log(`\n🔧 调用工具: ${ev.tool.name}(${JSON.stringify(ev.tool.parameters)})`);
  if (ev.type === "tool_result") console.log(`   → 结果: ${ev.result}`);
}
console.log("\n✅ 完成");
