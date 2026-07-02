// 测试新 TUI 的核心功能
import pty from "@lydell/node-pty";

const TUI = "/Users/mac/Documents/vscodeProject/maou-sdk/tui";
const PRELOAD = `${TUI}/preload.mjs`;
const INDEX = `${TUI}/src/index.ts`;

async function spawnTui(cols = 80, rows = 24, env = {}) {
  const t = pty.spawn("/Users/mac/.nvm/versions/node/v24.13.0/bin/node", ["--import", PRELOAD, INDEX], {
    cols, rows, cwd: TUI, env: { ...process.env, FORCE_COLOR: "1", COLORTERM: "truecolor", ...env },
  });
  return t;
}

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g, "").replace(/\x1b[()][AB0-2]/g, "").replace(/\r/g, "");
const w = (s) => process.stderr.write(String(s) + "\n");

// 测试 1：启动 + 渲染
w("=== 测试 1：启动渲染 ===");
const t = await spawnTui();
let out = ""; t.onData((d) => (out += d));
await new Promise((r) => setTimeout(r, 1500));
const screen = strip(out);
w("有 MAOU: " + screen.includes("MAOU"));
w("有输入框: " + screen.includes("input"));
w("有 BSU: " + out.includes("\x1b[?2026"));
w("无错误: " + !/Error|Cannot find/.test(screen));

// 测试 2：逐字符输入 + Enter 发送
w("\n=== 测试 2：输入 + Enter 发送 ===");
for (const ch of "只回复收到") { t.write(ch); await new Promise((r) => setTimeout(r, 30)); }
t.write("\r");
let waited = 0;
while (waited < 15000) { await new Promise((r) => setTimeout(r, 500)); waited += 500; if (strip(out).includes("收到") && strip(out).includes("ch.01")) break; }
const after = strip(out);
w("有 user 消息: " + after.includes("只回复收到"));
w("有 assistant 回复: " + (after.includes("收到") && after.split("收到").length > 2));
w("done (ch.01): " + after.includes("ch.01"));
w("状态栏有 token: " + /k\//.test(after));

// 测试 3：Alt+Enter 换行
w("\n=== 测试 3：Alt+Enter 换行 ===");
t.write("\x15"); // Ctrl+U 清空
await new Promise((r) => setTimeout(r, 200));
for (const ch of "hi") { t.write(ch); await new Promise((r) => setTimeout(r, 30)); }
t.write("\x1b\r"); // Alt+Enter
await new Promise((r) => setTimeout(r, 300));
for (const ch of "world") { t.write(ch); await new Promise((r) => setTimeout(r, 30)); }
await new Promise((r) => setTimeout(r, 300));
const altScreen = strip(out);
const inputLines = altScreen.split("\n").filter((l) => l.includes("hi") || l.includes("world"));
w("hi 和 world 在不同行: " + !inputLines.some((l) => l.includes("hi") && l.includes("world")));

// 退出
t.write("\x15"); await new Promise((r) => setTimeout(r, 100));
// /quit
for (const ch of "/quit") { t.write(ch); await new Promise((r) => setTimeout(r, 30)); }
t.write("\r");
await new Promise((r) => setTimeout(r, 500));
try { t.kill(); } catch {}
w("\n=== 完成 ===");
process.exit(0);
