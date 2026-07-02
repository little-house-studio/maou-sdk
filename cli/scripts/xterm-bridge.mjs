/**
 * xterm-bridge.mjs —— 用 @xterm/headless 做假终端，驱动 CLI 渲染。
 *
 * 原理：xterm headless 是纯 JS 终端状态机。把 CLI 的 stdout 输出喂给 xterm.write，
 * CLI 的 stdin 由我们 fake（isTTY:true + setRawMode），键盘/鼠标 SGR 序列由我们喂。
 * xterm 维护字符网格 + 颜色，可精确读每个 cell。
 *
 * 优势：纯 JS 无 fork（沙箱稳定）、能控大小、能喂鼠标 SGR、能读 cell 字符+颜色。
 * 限制：fake stdin 的 raw mode 是 no-op（但 Ink 会调 setRawMode，我们假装成功）。
 */

import { spawn } from "node:child_process";
import xterm from "@xterm/headless";
const { Terminal } = xterm;

const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";
const NODE = "/Users/mac/.nvm/versions/node/v24.13.0/bin/node";

export async function spawnCli({ cols = 100, rows = 32, cwd = "/Users/mac/Downloads/coding测试", env = {} } = {}) {
  const term = new Terminal({ cols, rows, allowProposedApi: true });

  // 用 child_process spawn CLI（不通过 pty，避免 fork 问题）
  // stdin/stdout 用 pipe，但我们要 fake isTTY——Ink 检查 process.stdout.isTTY。
  // 用 stdio: ['pipe','pipe','pipe']，子进程的 stdout 不是 TTY，Ink 会走 CI 模式……
  // 解决：传环境变量 + 用 pty？不行。改：直接在子进程里 monkeypatch。
  // 实际上 Ink 在非 TTY 下会报 raw mode 错。我们需要让子进程以为 stdin 是 TTY。
  // 最简单：用一个 wrapper 脚本 monkeypatch process.stdin/stdout 的 isTTY。

  const wrapperCode = `
    // monkeypatch stdin/stdout 为 TTY，让 Ink 满意
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: ${cols}, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: ${rows}, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    process.stdin.setRawMode = () => process.stdin;
    process.stdin.ref = () => {}; process.stdin.unref = () => {};
    // 导入 CLI
    await import("${CLI}");
  `;

  const child = spawn(NODE, ["--input-type=module", "-e", wrapperCode], {
    cwd, env: { ...process.env, FORCE_COLOR: "1", COLORTERM: "truecolor", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 子进程 stdout → xterm
  child.stdout.on("data", (buf) => {
    term.write(buf.toString("utf-8"));
  });
  child.stderr.on("data", (buf) => {
    process.stderr.write("[cli stderr] " + buf.toString("utf-8"));
  });

  let dead = false;
  child.on("exit", (code) => { dead = true; });

  const api = {
    term,
    child,
    write: (s) => { if (!dead) child.stdin.write(s); },
    resize: (c, r) => {
      term.resize(c, r);
      // 子进程的 stdout.columns/rows 是 monkeypatch 的固定值，无法动态改——
      // resize 后子进程不会感知。这是此方案的局限：resize 不完全生效。
      // 但 xterm 侧能渲染新尺寸（CLI 输出按原尺寸，xterm 重新布局）。
    },
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    /** 读某行（trim trailing spaces） */
    line: (row) => {
      const l = term.buffer.active.getLine(row);
      return l ? l.translateToString(true) : "";
    },
    /** 读全屏行数组 */
    screen: () => {
      const out = [];
      for (let r = 0; r < term.buffer.active.length; r++) {
        const l = term.buffer.active.getLine(r);
        if (l) out.push(l.translateToString(true));
      }
      return out;
    },
    /** 找含关键字的行 */
    grep: (re) => api.screen().filter(l => re.test(l)),
    /** 读某 cell 的颜色 */
    cellFg: (row, col) => {
      const l = term.buffer.active.getLine(row);
      return l ? l.getCell(col)?.getFgColor() : -1;
    },
    cellBg: (row, col) => {
      const l = term.buffer.active.getLine(row);
      return l ? l.getCell(col)?.getBgColor() : -1;
    },
    // 鼠标 SGR-1006（喂进 stdin，Ink 的 useInput 会收到）
    mouseDown: (col, row, button = 0) => api.write(`\x1b[<${button};${col};${row}M`),
    mouseUp: (col, row, button = 0) => api.write(`\x1b[<${button};${col};${row}m`),
    mouseDrag: (col, row) => api.write(`\x1b[<32;${col};${row}M`),
    wheelUp: (col, row) => api.write(`\x1b[<64;${col};${row}M`),
    wheelDown: (col, row) => api.write(`\x1b[<65;${col};${row}M`),
    click: async (col, row, button = 0) => {
      api.write(`\x1b[<${button};${col};${row}M`);
      await api.wait(50);
      api.write(`\x1b[<${button};${col};${row}m`);
    },
    quit: async () => {
      try { api.write("\x03"); } catch {}
      await api.wait(200);
      try { child.kill("SIGKILL"); } catch {}
      dead = true;
    },
  };
  return api;
}
