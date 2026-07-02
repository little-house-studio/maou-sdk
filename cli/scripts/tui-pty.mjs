// node-pty 真伪终端测试：跑 CLI，喂键盘+鼠标 SGR 序列，捕获带 ANSI 的真实输出。
// 能发现：双重鼠标事件、聚焦路由、滚轮、点击移光标、SGR 序列泄漏进 textarea 等真实 bug。
process.on("uncaughtException", (e) => { process.stderr.write("UNCAUGHT: " + (e?.stack || e) + "\n"); process.exit(1); });

import pty from "node-pty";
import { spawn } from "node:child_process";

const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";
const CWD = "/Users/mac/Downloads/coding测试";

// 用 node-pty 创建真伪终端（env node 规避 posix_spawnp 路径问题）
const term = pty.spawn("/usr/bin/env", ["node", CLI], {
  name: "xterm-256color",
  cols: 100, rows: 32,
  cwd: CWD,
  env: { ...process.env, MAOU_MOUSE: "1", FORCE_COLOR: "1", COLORTERM: "truecolor" },
});

const frames = [];
let buf = "";
let frameCount = 0;
term.onData((data) => {
  buf += data;
  frames.push(data);
});

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g, "").replace(/\x1b[()][AB0-2]/g, "").replace(/\r/g, "");

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const snapshot = (label) => {
  process.stderr.write("\n═══ " + label + " ═══\n");
  process.stderr.write(stripAnsi(buf).slice(-1500) + "\n");
  buf = "";
};

await wait(800);
snapshot("1.启动初始屏");

// 测键盘输入字符
term.write("hello");
await wait(300);
snapshot("2.键盘输入hello");

// 测退格
term.write("\x7f\x7f"); // 退格两次
await wait(300);
snapshot("3.退格两次(应剩hel)");

// 测 Ctrl+U 清空
term.write("\x15");
await wait(300);
snapshot("4.Ctrl+U清空");

// 测 Ctrl+K 命令面板
term.write("\x0b"); // Ctrl+K
await wait(400);
snapshot("5.Ctrl+K命令面板");

// 测 ↓ 导航
term.write("\x1b[B"); // ↓
await wait(300);
snapshot("6.↓导航");

// Esc 关闭
term.write("\x1b");
await wait(300);
snapshot("7.Esc关闭");

// 测鼠标：SGR-1006 点击输入框（row=32 是底部，输入框约 row 30）
// 1002 模式已开（MAOU_MOUSE=1）。点击格式 \x1b[<0;col;row M
term.write("\x1b[<0;5;30M"); // 点击输入框 col5 row30
await wait(300);
snapshot("8.鼠标点击输入框(光标应移)");

// 测滚轮
term.write("\x1b[<64;50;10M"); // wheelUp
await wait(300);
snapshot("9.滚轮向上");

// 检查是否有 SGR 序列泄漏进输入框（"点击插入乱码"bug）
const leakCheck = stripAnsi(frames.join("")).includes("[<0;");
process.stderr.write("\n=== SGR 序列泄漏进文本: " + leakCheck + " ===\n");

// 退出
term.write("\x03"); // Ctrl+C
await wait(300);
process.stderr.write("\n=== 退出，总数据量: " + frames.length + " chunks ===\n");
term.kill();
process.exit(0);
