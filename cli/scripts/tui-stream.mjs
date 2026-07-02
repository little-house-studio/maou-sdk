// 流式渲染测试：渲染 App，通过 store.onStream 喂预录事件序列，看渲染。
// 不调真实 LLM，用 reducer 已验证的事件序列模拟一轮对话（含思考+工具）。
process.on("uncaughtException", (e) => { process.stderr.write("UNCAUGHT: " + (e?.stack || e) + "\n"); process.exit(1); });

import React from "react";
import { render } from "ink-testing-library";
import { EventEmitter } from "node:events";

const cfg = (await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/dist/cli-config.js")).default;
const { App } = await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/app.js");
const { useStore } = await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/state/store.js");

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g, "").replace(/\x1b[()][AB0-2]/g, "");

const fakeStdout = Object.assign(new EventEmitter(), { columns: 100, rows: 32, isTTY: true, write: () => true });
const fakeStdin = Object.assign(new EventEmitter(), { isTTY: true, setEncoding:()=>{}, setRawMode:()=>fakeStdin, ref:()=>{}, unref:()=>{}, resume:()=>fakeStdin, pause:()=>fakeStdin, read:()=>null });
Object.defineProperty(process, "stdout", { value: fakeStdout, configurable: true });
Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });

const { frames, stdin, unmount } = render(React.createElement(App, { config: cfg }), { stdout: fakeStdout, stdin: fakeStdin });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const dump = (label) => {
  const last = frames[frames.length - 1] || "";
  process.stderr.write("\n═══ " + label + " ═══\n" + stripAnsi(last) + "\n");
};

await wait(200);
// 设真实 provider/model/maxContext（App 初始化已做，但确保）
useStore.getState().setAgentMeta("coding", "xfyun-qwen-coding", "xopqwen36v35b", 128000);

// 模拟用户发送
useStore.getState().pushUserMessage("读 README.md 并总结");
await wait(100); dump("1.user消息+思考中");

// 喂 thinking_delta 流
useStore.getState().onStream({ type: "thinking_delta", delta: "让我看看 README..." });
await wait(100); dump("2.thinking流");

// 喂 assistant_delta 流
useStore.getState().onStream({ type: "assistant_delta", delta: "我先" });
useStore.getState().onStream({ type: "assistant_delta", delta: "读一下文件。" });
await wait(100); dump("3.assistant流");

// tool_call（读文件）
useStore.getState().onStream({ type: "tool_call", tool: { id: "t1", name: "reader", parameters: { path: "README.md" } } });
await wait(100); dump("4.tool_call卡片");

// tool_result
useStore.getState().onStream({ type: "tool_result", toolCallId: "t1", name: "reader", content: "# Speech to Text\n基于 Whisper 的语音转文本工具...", ok: true });
await wait(100); dump("5.tool_result(卡片应变✓)");

// 继续 assistant_delta
useStore.getState().onStream({ type: "assistant_delta", delta: "这是基于 Whisper 的语音转文本工具。" });
await wait(100); dump("6.继续流");

// model.usage + assistant 完整
useStore.getState().onStream({ type: "assistant", content: "这是基于 Whisper 的语音转文本工具。", round: 1, usage: { prompt_tokens: 1200, completion_tokens: 80, max_context: 128000 } });
await wait(100); dump("7.assistant完整(usage)");

// done
useStore.getState().onStream({ type: "done", rounds: 1 });
await wait(100); dump("8.done(状态栏应有sparkline+token)");

process.stderr.write("\n=== 帧数: " + frames.length + " ===\n");
unmount();
setTimeout(() => process.exit(0), 100);
