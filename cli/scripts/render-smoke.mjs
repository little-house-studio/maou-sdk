// 渲染冒烟测试：假 stdout 渲染 App，确认组件树不崩 + 关键元素出现。
import React from "react";
import { render } from "ink";
import { EventEmitter } from "node:events";

const frames = [];
const fakeStdout = Object.assign(new EventEmitter(), {
  columns: 120, rows: 40, isTTY: false,
  write: (s) => { frames.push(String(s)); return true; },
});
const fakeStdin = Object.assign(new EventEmitter(), {
  isTTY: false,
  setEncoding: () => {}, setRawMode: () => fakeStdin, ref: () => {}, unref: () => {}, resume: () => fakeStdin, pause: () => fakeStdin,
  read: () => null,
});

Object.defineProperty(process, "stdout", { value: fakeStdout, configurable: true });
Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });

const cfg = (await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/dist/cli-config.js")).default;
const { App } = await import("file:///Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/app.js");

try {
  const inst = render(React.createElement(App, { config: cfg }), {
    stdout: fakeStdout, stdin: fakeStdin, exitOnCtrlC: false, patchConsole: false,
  });
  await new Promise(r => setTimeout(r, 150));
  const out = frames.join("");
  process.stderr.write("frames: " + frames.length + "\n");
  process.stderr.write("has MAOU: " + out.includes("MAOU") + "\n");
  process.stderr.write("has agent(coding): " + out.includes("coding") + "\n");
  process.stderr.write("has input placeholder: " + /输入/.test(out) + "\n");
  process.stderr.write("has REC/○ status: " + /[○●]/.test(out) + "\n");
  process.stderr.write("has timecode pattern: " + /\d{2}:\d{2}:\d{2}/.test(out) + "\n");
  process.stderr.write("has channel [ch: " + /ch\.\d+/.test(out) + "\n");
  inst.unmount();
  process.stderr.write("SMOKE: OK (no crash)\n");
  process.exit(0);
} catch (e) {
  process.stderr.write("SMOKE FAIL: " + (e?.stack || e?.message || e) + "\n");
  process.exit(1);
}
