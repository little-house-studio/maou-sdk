/**
 * ctrlc-overlay-demo.mjs —— 验证 Ctrl+C 真退出 + overlay 鼠标点击。
 *
 * 1. Ctrl+C：启动→Ctrl+C 警告→3秒内再按→进程真退（exitCode 130，无残留）
 * 2. overlay 点击：Ctrl+K 开命令面板→鼠标点选项→触发
 */
import { spawn } from "node:child_process";
import xtermNs from "@xterm/headless";
const { Terminal } = xtermNs;

const NODE = "/Users/mac/.nvm/versions/node/v24.13.0/bin/node";
const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";
const CWD = "/Users/mac/Downloads/coding测试";

function spawnCli({ cols = 100, rows = 32 } = {}) {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const wrapperCode = `
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: ${cols}, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: ${rows}, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    process.stdin.setRawMode = () => process.stdin;
    process.stdin.ref = () => {}; process.stdin.unref = () => {};
    await import("${CLI}");
  `;
  const child = spawn(NODE, ["--input-type=module", "-e", wrapperCode], {
    cwd: CWD,
    env: { ...process.env, TERM_PROGRAM: "iTerm.app", FORCE_COLOR: "1", COLORTERM: "truecolor" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let dead = false;
  child.stdout.on("data", (buf) => term.write(buf.toString("utf-8")));
  child.stderr.on("data", (buf) => process.stderr.write("[cli stderr] " + buf.toString("utf-8")));
  child.on("exit", () => { dead = true; });
  const api = {
    child, dead: () => dead,
    write: (s) => { if (!dead) child.stdin.write(s); },
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    line: (row) => { const l = term.buffer.active.getLine(row); return l ? l.translateToString(true) : ""; },
    screen: () => {
      const out = [];
      for (let r = 0; r < term.buffer.active.length; r++) {
        const l = term.buffer.active.getLine(r); if (l) out.push(l.translateToString(true));
      }
      return out;
    },
    mouseDown: (col, row, b = 0) => api.write(`\x1b[<${b};${col};${row}M`),
    mouseUp: (col, row, b = 0) => api.write(`\x1b[<${b};${col};${row}m`),
    click: async (col, row) => { api.mouseDown(col, row); await api.wait(80); api.mouseUp(col, row); await api.wait(300); },
    quit: async () => { try { api.write("\x03"); } catch {} await api.wait(200); try { child.kill("SIGKILL"); } catch {} },
  };
  return api;
}

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`); cond ? pass++ : fail++; };

// ── Case 1: Ctrl+C 真退出 ──
{
  const t = spawnCli();
  await t.wait(1500);
  // 第一次 Ctrl+C（空闲态）：警告
  t.write("\x03");
  await t.wait(300);
  const screen1 = t.screen().join("\n");
  const warned = screen1.includes("再按一次") || screen1.includes("退出");
  ok("Ctrl+C 第一次警告", warned, "");

  // 3 秒内第二次 → 真退出
  const exitPromise = new Promise((resolve) => t.child.on("exit", (code) => resolve(code)));
  t.write("\x03");
  const exitCode = await Promise.race([
    exitPromise,
    new Promise((r) => setTimeout(() => r("timeout"), 3000)),
  ]);
  ok("Ctrl+C 第二次真退出", exitCode !== "timeout" && typeof exitCode === "number",
     `exitCode=${exitCode}`);
  if (exitCode === "timeout") { try { t.child.kill("SIGKILL"); } catch {} }
}

// ── Case 2: overlay 鼠标点击 ──
{
  const t = spawnCli();
  await t.wait(1500);
  // Ctrl+K 开命令面板
  t.write("\x0b");
  await t.wait(500);
  const screen = t.screen();
  const overlayRow = screen.findIndex(l => l.includes("命令") || l.includes("▸"));
  ok("Ctrl+K 开命令面板", overlayRow >= 0, `overlayRow=${overlayRow}`);

  if (overlayRow >= 0) {
    // overlay 选项从 row 5 起（xterm），文字从 col 6。试 col 8 几行
    let triggered = false;
    for (const r of [6, 7, 5, 8]) {
      const before = t.screen().join("\n");
      await t.click(8, r);
      await t.wait(300);
      const after = t.screen().join("\n");
      if (before !== after) { triggered = true; break; }
    }
    ok("鼠标点 overlay 选项", triggered, "");
  }
  await t.quit();
}

log(`\n${pass} pass, ${fail} fail / ${pass + fail} total`);
await new Promise(r => setTimeout(r, 200));
process.exit(fail > 0 ? 1 : 0);
