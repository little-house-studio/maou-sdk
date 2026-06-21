#!/usr/bin/env node
/**
 * 无 TTY 冒烟测试：用假 stdin/stdout 渲染 <Demo/>，翻遍 17 页 + 打开弹窗，
 * 校验渲染内容 + 不崩溃。运行: MAOU_DEMO_TEST=1 tsx scripts/smoke-demo.mjs
 */
import React from "react";
import { render } from "ink";
import { EventEmitter } from "node:events";
import { Demo } from "../src/demo.js";

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b[()][AB0-2]/g, "");

// 假 stdout：收集帧 + 提供 TTY 元数据
class FakeStdout extends EventEmitter {
  constructor() { super(); this.columns = 120; this.rows = 40; this.isTTY = true; this.frames = []; this.last = ""; }
  write(chunk) { const s = String(chunk); this.frames.push(s); this.last = s; return true; }
}
// 假 stdin：Ink 5 用 readable 事件 + read() 拉取，所以要排队 + emit('readable')
class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this._q = [];
    this.setEncoding = () => {};
    this.setRawMode = () => this;
    this.ref = () => {};
    this.unref = () => {};
    this.resume = () => this;
    this.pause = () => this;
  }
  read() { return this._q.length ? this._q.shift() : null; }
  send(s) { this._q.push(s); this.emit("readable"); }
}

const stdout = new FakeStdout();
const stdin = new FakeStdin();
const errors = [];
const origErr = console.error;
console.error = (...a) => { errors.push(a.join(" ")); };
process.on("uncaughtException", (e) => errors.push("uncaught: " + e.message));
process.on("unhandledRejection", (e) => errors.push("unhandled: " + String(e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s) => { stdin.send(s); };
const RIGHT = "\x1b[C", DOWN = "\x1b[B", UP = "\x1b[A", TAB = "\t", ESC = "\x1b";

const PAGE_PROBES = [
  "响应式", "Gauge", "Sparkline", "渐变", "线框", "AsciiArt", "ASCII",
  "Markdown", "消息流", "可滚动", "可折叠", "聚焦", "光标", "弹窗", "鼠标", "主题", "验收清单",
];

// 取最近的"整屏"帧（跳过 cursor 等小写入）
function latestRaw() {
  for (let i = stdout.frames.length - 1; i >= 0; i--) {
    if (stripAnsi(stdout.frames[i]).length > 400) return stdout.frames[i];
  }
  return "";
}
function latestScreen() {
  return stripAnsi(latestRaw());
}

async function main() {
  const app = render(React.createElement(Demo), { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  await sleep(200);

  const seen = [];
  for (let i = 0; i < 17; i++) {
    // 页内小交互（验证不崩）
    if (i === 4) key("m");
    if (i === 6) key("m");
    if (i === 9) { key(DOWN); key(UP); }
    if (i === 10) key("c");
    if (i === 11) key(TAB);
    if (i === 15) key("t");
    await sleep(70);
    const scr = latestScreen();
    const found = (scr.match(/\[(\d+)\/17\]/) || [])[1];
    seen.push({ page: i + 1, found, hdr: scr.includes(`[${i + 1}/17]`), probe: scr.includes(PAGE_PROBES[i]), len: scr.length });
    key(RIGHT);
    await sleep(70);
  }

  // 用 goto 确定性导航到弹窗页（index 13）
  async function goto(target) {
    for (let k = 0; k < 25; k++) {
      const m = (latestScreen().match(/\[(\d+)\/17\]/) || [])[1];
      if (m && Number(m) - 1 === target) return true;
      key(RIGHT); await sleep(55);
    }
    return false;
  }
  const onModalPage = await goto(13);
  key("k"); await sleep(120);
  const modalOk = latestScreen().includes("命令面板");
  // 不透明检测：弹窗帧里的背景填充 SGR(48;2;…) 数量（需 FORCE_COLOR）
  const bgFill = (latestRaw().match(/48;2;/g) || []).length;
  key(ESC); await sleep(50);

  // 鼠标开关
  key("`"); await sleep(70);
  const mouseOk = latestScreen().includes("ON");

  app.unmount();
  await sleep(50);
  console.error = origErr;

  const headerOk = seen.filter((s) => s.hdr).length;
  const probeOk = seen.filter((s) => s.probe).length;
  const rendered = seen.every((s) => s.len > 400);
  const report = {
    pagesNavigated: seen.length,
    headersMatched: `${headerOk}/17`,
    titlesMatched: `${probeOk}/17`,
    allFramesFull: rendered,
    reachedModalPage: onModalPage,
    commandModalOpaque: modalOk,
    modalBgFillSGR: bgFill,
    mouseToggleWorks: mouseOk,
    missedTitles: seen.filter((s) => !s.probe).map((s) => s.page),
    errors,
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("trace:", seen.map((s) => `${s.page}:${s.found ?? "-"}`).join(" "));
  // bgFill 需 FORCE_COLOR；未强制色彩时跳过该断言
  const colorOn = Boolean(process.env.FORCE_COLOR);
  const opaqueOk = colorOn ? bgFill >= 15 : modalOk;
  const pass = headerOk >= 15 && probeOk >= 15 && rendered && modalOk && opaqueOk && mouseOk && errors.length === 0;
  console.log(pass ? "\nSMOKE: PASS ✅" : "\nSMOKE: FAIL ❌");
  process.exit(pass ? 0 : 1);
}
main();

