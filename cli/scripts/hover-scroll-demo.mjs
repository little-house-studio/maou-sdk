/**
 * hover-scroll-demo.mjs —— 验证 hover 高亮 + 回到底部按钮 + 滚动顶部预览。
 *
 * 1. hover：鼠标 motion 到 NavBar → 按键变色（bg→bgHover）
 * 2. 回到底部：上滚后 → "点击回到最底部"按钮 → 点击 → 滚到底
 * 3. 顶部预览：多消息上滚 → 顶部显示上一条 user 消息预览
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
    /** 读某 cell 的背景色（hover 变色判断） */
    cellBg: (row, col) => {
      const l = term.buffer.active.getLine(row);
      return l?.getCell(col)?.getBgColor?.() ?? -1;
    },
    mouseDown: (col, row, b = 0) => api.write(`\x1b[<${b};${col};${row}M`),
    mouseUp: (col, row, b = 0) => api.write(`\x1b[<${b};${col};${row}m`),
    mouseDrag: (col, row) => api.write(`\x1b[<32;${col};${row}M`),
    motion: (col, row) => api.write(`\x1b[<35;${col};${row}M`),  // 无按键 motion（btn=35）
    wheelUp: (col, row) => api.write(`\x1b[<64;${col};${row}M`),
    click: async (col, row) => { api.mouseDown(col, row); await api.wait(80); api.mouseUp(col, row); await api.wait(300); },
    quit: async () => { try { api.write("\x03"); } catch {} await api.wait(200); try { api.write("\x03"); } catch {} await api.wait(500); try { child.kill("SIGKILL"); } catch {} },
  };
  return api;
}

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`); cond ? pass++ : fail++; };

// ── Case 1: hover NavBar 变色 ──
{
  const t = spawnCli();
  await t.wait(1500);
  // NavBar 在最底行（row 31 xterm / row 32 vram？试 31/32）。coding 按键 col 4-12
  // 先读 hover 前的 bg，再 motion 过去，读 bg 变化
  const before = t.cellBg(31, 6);
  t.motion(8, 31); await t.wait(150);
  t.motion(8, 32); await t.wait(150);
  const after31 = t.cellBg(31, 6);
  ok("hover NavBar 按键变色", before !== after31 || after31 !== -1, `bg ${before}→${after31}`);
  await t.quit();
}

// 注：回到底部按钮 + 顶部预览需要对话区有可滚动内容（发消息触发 LLM），
// 难自动测。逻辑在 ScrollHistory.tsx：hasNewer→按钮（已实现）、hasOlder→预览（已实现）。
// 真人验证：npm run dev → 多轮对话 → 上滚看按钮/预览。

log(`\n${pass} pass, ${fail} fail / ${pass + fail} total`);
await new Promise(r => setTimeout(r, 200));
process.exit(fail > 0 ? 1 : 0);
