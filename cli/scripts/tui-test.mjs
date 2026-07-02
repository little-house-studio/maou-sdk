// TUI 测试：渲染 App，模拟真实使用流程，捕获渲染帧，发现 bug。
process.on("uncaughtException", (e) => { process.stderr.write("UNCAUGHT: " + (e?.stack || e) + "\n"); process.exit(1); });
process.on("unhandledRejection", (e) => { process.stderr.write("UNHANDLED: " + (e?.stack || e) + "\n"); process.exit(1); });

import React from "react";
import { render } from "ink-testing-library";
import { EventEmitter } from "node:events";

const cfg = (await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/dist/cli-config.js")).default;
const { App } = await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/app.js");

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g, "").replace(/\x1b[()][AB0-2]/g, "");

const fakeStdout = Object.assign(new EventEmitter(), {
  columns: 120, rows: 40, isTTY: true, write: () => true,
});
const fakeStdin = Object.assign(new EventEmitter(), {
  isTTY: true, setEncoding: () => {}, setRawMode: () => fakeStdin,
  ref: () => {}, unref: () => {}, resume: () => fakeStdin, pause: () => fakeStdin, read: () => null,
});
Object.defineProperty(process, "stdout", { value: fakeStdout, configurable: true });
Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });

process.stderr.write("=== 渲染 App 初始状态 ===\n");
const { rerender, unmount, frames, stdin } = render(React.createElement(App, { config: cfg }), {
  stdout: fakeStdout, stdin: fakeStdin,
});

await new Promise(r => setTimeout(r, 300));
const dumpFrame = (label) => {
  const last = frames[frames.length - 1] || "";
  process.stderr.write("\n=== " + label + " (帧数:" + frames.length + ") ===\n");
  process.stderr.write(stripAnsi(last) + "\n");
};
dumpFrame("初始");

// 模拟输入字符（ink-testing-library stdin.write）
process.stderr.write("\n=== 模拟输入 'hello' ===\n");
stdin.write("hello");
await new Promise(r => setTimeout(r, 200));
dumpFrame("输入 hello 后");

// 模拟 Enter 发送（但 streaming 会真调 LLM，跳过；改为测 '/' 触发补全）
process.stderr.write("\n=== 清空后输入 '/' 触发补全 ===\n");
// 先退格清掉 hello
for (let i = 0; i < 5; i++) stdin.write("\x7f");
await new Promise(r => setTimeout(r, 100));
stdin.write("/");
await new Promise(r => setTimeout(r, 200));
dumpFrame("输入 / 后（应有补全菜单）");

// 模拟 Ctrl+K 命令面板
process.stderr.write("\n=== Ctrl+K 命令面板 ===\n");
for (let i = 0; i < 2; i++) stdin.write("\x7f"); // 清掉 /
await new Promise(r => setTimeout(r, 100));
stdin.write("\x0b"); // Ctrl+K
await new Promise(r => setTimeout(r, 200));
dumpFrame("Ctrl+K 后（应有命令面板）");

process.stderr.write("\n---END---\n");
unmount();
setTimeout(() => process.exit(0), 100);
