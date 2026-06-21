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

  // 验证输入框删除：到第13页(index12)，打字→记录索引→退格→索引应-1
  async function goto(target) {
    for (let k = 0; k < 25; k++) {
      const m = (latestScreen().match(/\[(\d+)\/17\]/) || [])[1];
      if (m && Number(m) - 1 === target) return true;
      key(RIGHT); await sleep(55);
    }
    return false;
  }
  await goto(12); await sleep(60);
  key("Z"); await sleep(60);
  const cIdxAfterType = Number((latestScreen().match(/索引\s*(\d+)/) || [])[1] ?? -1);
  key("\x7f"); await sleep(60); // DEL = 退格
  const cIdxAfterDel = Number((latestScreen().match(/索引\s*(\d+)/) || [])[1] ?? -1);
  const deleteWorks = cIdxAfterType >= 1 && cIdxAfterDel === cIdxAfterType - 1;

  // 开鼠标（1002 拖动模式），验证状态栏 ON
  key("`"); await sleep(70);
  const mouseOk = latestScreen().includes("ON");
  // 拖选复制：useMouse 监听真实 process.stdin，所以鼠标 SGR 发到 process.stdin
  const mseq = (b, c, r, tail) => Buffer.from(`\x1b[<${b};${c};${r}${tail}`, "latin1");
  // 纯单击移光标（down+up 同列，无 drag）→ 光标到点击处
  process.stdin.emit("data", mseq(0, 10, 20, "M")); await sleep(45);
  process.stdin.emit("data", mseq(0, 10, 20, "m")); await sleep(70);
  const clickCursor = Number((latestScreen().match(/光标索引\s*(\d+)/) || [])[1] ?? -1);
  const clickCursorWorks = clickCursor === 1; // 列10→rel2→字符索引1
  process.stdin.emit("data", mseq(0, 8, 20, "M"));   await sleep(45); // down @列8 → 字符0(锚)
  process.stdin.emit("data", mseq(32, 14, 20, "M")); await sleep(45); // drag @列14
  process.stdin.emit("data", mseq(0, 18, 20, "m"));  await sleep(110); // up @列18 → OSC52 复制
  const KNOWN_INPUT = "点这行→中文abc混排定位";
  const oscm = stdout.frames.join("").match(/\x1b\]52;c;([A-Za-z0-9+/=]+)\x07/);
  const copiedText = oscm ? Buffer.from(oscm[1], "base64").toString("utf8") : "";
  const osc52Works = !!oscm && copiedText.length > 0 && KNOWN_INPUT.includes(copiedText);

  // 用 goto 确定性导航到弹窗页（index 13）
  const onModalPage = await goto(13);
  key("k"); await sleep(120);
  const modalOk = latestScreen().includes("命令面板");
  // 不透明检测：弹窗帧里的背景填充 SGR(48;2;…) 数量（需 FORCE_COLOR）
  const bgFill = (latestRaw().match(/48;2;/g) || []).length;
  key(ESC); await sleep(50);

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
    inputDeleteWorks: deleteWorks,
    mouseToggleWorks: mouseOk,
    clickMovesCursor: clickCursorWorks,
    osc52CopyWorks: osc52Works,
    osc52CopiedText: copiedText,
    missedTitles: seen.filter((s) => !s.probe).map((s) => s.page),
    errors,
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("trace:", seen.map((s) => `${s.page}:${s.found ?? "-"}`).join(" "));
  // bgFill 需 FORCE_COLOR；未强制色彩时跳过该断言
  const colorOn = Boolean(process.env.FORCE_COLOR);
  const opaqueOk = colorOn ? bgFill >= 15 : modalOk;
  const pass = headerOk >= 15 && probeOk >= 15 && rendered && modalOk && opaqueOk && deleteWorks && mouseOk && clickCursorWorks && osc52Works && errors.length === 0;
  console.log(pass ? "\nSMOKE: PASS ✅" : "\nSMOKE: FAIL ❌");
  process.exit(pass ? 0 : 1);
}
main();

