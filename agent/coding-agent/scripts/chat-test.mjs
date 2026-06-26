/**
 * coding-agent 真实对话驱动 —— 直接装配 SDK 依赖，驱动编程 agent 跑一轮。
 * 用法: node scripts/chat-test.mjs "你的消息"
 */
import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import { join } from "node:path";
import { createCodingAgent, runCodingAgentCli } from "../dist/index.js";

const HOME = process.env.HOME ?? "";
const maouRoot = join(HOME, ".maou");
const projectRoot = "/Users/mac/Documents/vscodeProject/maou-agent"; // 绑定的项目

// ── 装配基础设施（照 harness/server.ts 模式）──
const configStore = new ConfigStore(projectRoot, maouRoot);
const config = configStore.get();
const preset = config.api?.presets?.[0];
if (!preset) { console.error("❌ 无可用 preset"); process.exit(1); }
console.log(`▶ 使用模型: ${preset.model} | preset keys: ${Object.keys(preset).join(",")}`);

const toolRegistry = new ToolRegistry();
registerBuiltins(toolRegistry);
const sessionStore = new SessionStore(join(projectRoot, ".maou", "sessions"));
const llmClient = new LLMClient();

// ── 创建编程 agent（物化 coding agent 定义 + 绑定项目）──
const agent = createCodingAgent({ projectRoot, maouRoot, configStore, sessionStore, toolRegistry, llmClient });
console.log(`▶ coding agent: name=${agent.agentName} | 白名单 ${agent.toolWhitelist.length} 项 | 项目=${agent.projectRoot}\n`);

const msg = process.argv[2] || "请用三到四句话介绍你自己，以及你能帮我做哪些编程相关的事。本轮不要调用任何工具。";
console.log(`👤 用户: ${msg}\n🤖 助手: `);

// 90s 超时保护
const ac = new AbortController();
const timer = setTimeout(() => { console.error("\n⏱ 超时，中止"); ac.abort(); }, 90000);

let sawDelta = false;
try {
  const sid = await runCodingAgentCli(msg, {
    agent,
    preset,
    signal: ac.signal,
    onEvent: (ev) => {
      if (ev.type === "assistant_delta" && ev.delta) { process.stdout.write(String(ev.delta)); sawDelta = true; }
      else if (ev.type === "field_complete") { /* 结构化字段，忽略噪声 */ }
      else if (ev.type === "tool_call") console.log(`\n  🔧 [tool_call] ${ev.tool?.name} ${JSON.stringify(ev.tool?.parameters ?? {})}`);
      else if (ev.type === "tool_result") console.log(`  ✅ [tool_result] ${String(ev.content ?? "").slice(0, 200)}`);
      else if (ev.type === "error") console.log(`\n  ❌ [error] ${ev.message}`);
      else if (ev.type === "round_limit") console.log(`\n  ⚠ ${ev.message}`);
    },
  });
  clearTimeout(timer);
  console.log(`\n\n✅ 完成 | sessionId=${sid} | 收到流式增量=${sawDelta}`);
} catch (err) {
  clearTimeout(timer);
  console.error(`\n❌ 运行失败: ${err?.stack || err}`);
  process.exit(1);
}
