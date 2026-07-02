/**
 * pty-xterm-driver.mjs —— @lydell/node-pty（真 TTY）+ @xterm/headless（屏幕状态机）。
 *
 * 业界标准组合：node-pty 传字节（真 raw mode，Enter/方向键/SGR 鼠标都正常），
 * xterm.js 解析 ANSI 维护字符网格（可读每个 cell 字符+颜色）。
 *
 * 能力：spawn CLI、resize、write 键盘/SGR 鼠标、读 screen 行、读 cell 颜色。
 * 比 xterm-bridge 强：真 raw mode（Enter 能发送）、resize 真生效、真终端行为。
 */

import pty from "@lydell/node-pty";
import xterm from "@xterm/headless";
const { Terminal } = xterm;

const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";

export async function spawnCli({ cols = 100, rows = 32, cwd = "/Users/mac/Downloads/coding测试", env = {}, retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const term = pty.spawn("/usr/bin/env", ["node", CLI], {
        cols, rows, cwd,
        env: { ...process.env, FORCE_COLOR: "1", COLORTERM: "truecolor", TERM: "xterm-256color", ...env },
      });
      return wrap(term, cols, rows);
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error(`spawnCli failed after ${retries} retries: ${lastErr?.message}`);
}

function wrap(pt, cols, rows) {
  const xt = new Terminal({ cols, rows, allowProposedApi: true });
  pt.onData((d) => { xt.write(d); });

  const api = {
    pt, xt,
    write: (s) => pt.write(s),
    /** 逐字符 write（模拟真终端逐键到达，避免 Ink 把多字符 chunk 当 paste） */
    type: async (s, delay = 30) => {
      for (const ch of s) { pt.write(ch); await new Promise(r => setTimeout(r, delay)); }
    },
    resize: (c, r) => { pt.resize(c, r); xt.resize(c, r); },
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    /** 脱 ANSI 的全屏文本 */
    text: () => {
      let out = "";
      for (let r = 0; r < xt.buffer.active.length; r++) {
        const l = xt.buffer.active.getLine(r);
        if (l) out += l.translateToString(true) + "\n";
      }
      return out;
    },
    /** 含 ANSI 的原始输出（用于颜色断言） */
    raw: () => { let o = ""; for (let r = 0; r < xt.buffer.active.length; r++) { const l = xt.buffer.active.getLine(r); if (l) o += l.translateToString(false) + "\n"; } return o; },
    /** 找含关键字的行 */
    grep: (re) => api.text().split("\n").filter(l => re.test(l)),
    /** 读某行 */
    line: (row) => xt.buffer.active.getLine(row)?.translateToString(true) ?? "",
    /** 读某 cell 前景色 */
    cellFg: (row, col) => xt.buffer.active.getLine(row)?.getCell(col)?.getFgColor() ?? -1,
    cellBg: (row, col) => xt.buffer.active.getLine(row)?.getCell(col)?.getBgColor() ?? -1,
    /** 读某 cell 字符 */
    cellChar: (row, col) => xt.buffer.active.getLine(row)?.getCell(col)?.getChars() ?? "",
    // 鼠标 SGR-1006
    mouseDown: (col, row, button = 0) => pt.write(`\x1b[<${button};${col};${row}M`),
    mouseUp: (col, row, button = 0) => pt.write(`\x1b[<${button};${col};${row}m`),
    mouseDrag: (col, row) => pt.write(`\x1b[<32;${col};${row}M`),
    wheelUp: (col, row) => pt.write(`\x1b[<64;${col};${row}M`),
    wheelDown: (col, row) => pt.write(`\x1b[<65;${col};${row}M`),
    click: async (col, row, button = 0) => {
      pt.write(`\x1b[<${button};${col};${row}M`);
      await api.wait(60);
      pt.write(`\x1b[<${button};${col};${row}m`);
    },
    drag: async (fromCol, fromRow, toCol, toRow) => {
      pt.write(`\x1b[<0;${fromCol};${fromRow}M`);
      await api.wait(40);
      for (let c = fromCol + 1; c <= toCol; c++) {
        pt.write(`\x1b[<32;${c};${fromRow}M`);
        await api.wait(15);
      }
      pt.write(`\x1b[<0;${toCol};${toRow}m`);
    },
    quit: async () => {
      try { pt.write("\x03"); } catch {}
      await api.wait(250);
      try { pt.kill(); } catch {}
    },
  };
  return api;
}
