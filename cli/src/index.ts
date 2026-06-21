#!/usr/bin/env node
/**
 * @little-house-studio/cli — Maou SDK 最小 CLI
 *
 * 对标 pi 的 `pi` 命令：一个交互式 agent REPL。
 * 默认内置几个简单工具（echo/add），展示如何用 @little-house-studio/agent 的 agentLoop。
 *
 * 用法:
 *   maou                          # 进入交互 REPL（需配 API key，见 --preset）
 *   maou --model claude-sonnet-4-5 --provider anthropic
 *
 * 也作为库导出：import { runCli } from "@little-house-studio/cli"
 */

import { createInterface } from "node:readline";
import { agentLoop } from "@little-house-studio/agent";
import { defineTool, Type, modelToAPIPreset, getEnvApiKey } from "@little-house-studio/llm";

// ─── 内置简单工具（最小 agent 的"简单工具"）──────────────────────────────────
const echo = defineTool({
  name: "echo",
  description: "原样回显一段文本",
  parameters: Type.Object({ text: Type.String({ description: "要回显的文本" }) }),
  execute: (args: { text: string }) => args.text,
});

const add = defineTool({
  name: "add",
  description: "两数相加",
  parameters: Type.Object({ a: Type.Number(), b: Type.Number() }),
  execute: (args: { a: number; b: number }) => `结果是 ${args.a + args.b}`,
});

const BUILTIN_TOOLS = [echo, add];

export interface CliOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  tools?: import("@little-house-studio/llm").DefinedTool[];
}

/**
 * 运行交互式 agent REPL。
 */
export async function runCli(opts: CliOptions = {}): Promise<void> {
  const provider = opts.provider ?? "anthropic";
  const model = opts.model ?? "claude-sonnet-4-5";

  // 解析 preset（优先显式 key → 环境变量 → 内置目录）
  let preset;
  try {
    preset = modelToAPIPreset(provider, model, { key: opts.apiKey ?? getEnvApiKey(provider) });
  } catch {
    console.error(`✗ 无法解析 ${provider}/${model}。请用 --provider/--model 指定，或设置 API key 环境变量。`);
    process.exit(1);
  }

  const tools = opts.tools?.length ? opts.tools : BUILTIN_TOOLS;
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(`Maou CLI — ${provider}/${model}（工具: ${tools.map((t) => t.name).join(", ")}）`);
  console.log("输入消息开始对话，Ctrl+C 退出。\n");

  const ask = () => rl.question("you> ", async (input) => {
    const text = input.trim();
    if (!text) return ask();
    process.stdout.write("maou> ");
    try {
      for await (const ev of agentLoop({ preset, tools, prompt: text, maxSteps: 6 })) {
        if (ev.type === "text") process.stdout.write(ev.delta);
        if (ev.type === "tool_call") process.stdout.write(`\n  [工具 ${ev.tool.name}] `);
      }
    } catch (err) {
      process.stdout.write(`\n[错误] ${err instanceof Error ? err.message : String(err)}`);
    }
    process.stdout.write("\n\n");
    ask();
  });
  ask();
}

// ─── bin 自启动 ──────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider") opts.provider = argv[++i];
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--api-key" || a === "--key") opts.apiKey = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log("用法: maou [--provider anthropic] [--model claude-sonnet-4-5] [--api-key KEY]");
      process.exit(0);
    }
  }
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(parseArgs(process.argv)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
