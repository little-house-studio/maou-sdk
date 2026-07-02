// TUI 完整交互测试：模拟真实使用流程，捕获每步渲染帧，发现 bug。
process.on("uncaughtException", (e) => { process.stderr.write("UNCAUGHT: " + (e?.stack || e) + "\n"); process.exit(1); });
process.on("unhandledRejection", (e) => { process.stderr.write("UNHANDLED: " + (e?.stack || e) + "\n"); process.exit(1); });

import React from "react";
import { render } from "ink-testing-library";
import { EventEmitter } from "node:events";

const cfg = (await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/dist/cli-config.js")).default;
const { App } = await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/app.js");

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g, "").replace(/\x1b[()][AB0-2]/g, "");

const fakeStdout = Object.assign(new EventEmitter(), {
  columns: 100, rows: 32, isTTY: true, write: () => true,
});
const fakeStdin = Object.assign(new EventEmitter(), {
  isTTY: true, setEncoding: () => {}, setRawMode: () => fakeStdin,
  ref: () => {}, unref: () => {}, resume: () => fakeStdin, pause: () => fakeStdin, read: () => null,
});
Object.defineProperty(process, "stdout", { value: fakeStdout, configurable: true });
Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });

const { frames, stdin, unmount } = render(React.createElement(App, { config: cfg }), {
  stdout: fakeStdout, stdin: fakeStdin,
});

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const dump = (label) => {
  const last = frames[frames.length - 1] || "";
  process.stderr.write("\n═══ " + label + " ═══\n");
  process.stderr.write(stripAnsi(last) + "\n");
};

await wait(300); dump("1.初始");

// 测补全：输入 /
stdin.write("/"); await wait(200); dump("2.输入/(应出补全菜单)");

// Tab 接受补全 → 应变成 /new
stdin.write("\t"); await wait(200); dump("3.Tab接受补全");

// Esc 关补全（但 /new 已接受，这里测 Ctrl+K 命令面板）
// 先清空输入
stdin.write("\x15"); await wait(150); // Ctrl+U 删到行首
dump("4.Ctrl+U清空后");

// Ctrl+K 命令面板
stdin.write("\x0b"); await wait(200); dump("5.Ctrl+K命令面板");

// ↓ 选择第二个
stdin.write("\x1b[B"); await wait(150); dump("6.↓选择第二个");

// ↓ 再下一个
stdin.write("\x1b[B"); await wait(150); dump("7.↓再下一个");

// Esc 关闭
stdin.write("\x1b"); await wait(200); dump("8.Esc关闭");

// Shift+Tab 循环思考级别
stdin.write("\x1b[Z"); await wait(150); dump("9.Shift+Tab循环思考");

process.stderr.write("\n=== 所有帧数: " + frames.length + " ===\n");
unmount();
setTimeout(() => process.exit(0), 100);
