/**
 * 方案1原型：拦截 Ink stdout，解析成字符网格，注入选区蓝底。
 *
 * 流程：
 * 1. Ink render() 输出到虚拟 stdout（PassThrough）
 * 2. 解析 Ink 输出（ESC[H 定位 + SGR 样式 + 文本）成二维网格 {char, sgr}[][]
 * 3. 选区内 cell 追加蓝底 SGR
 * 4. 重组字符串写到真实 stdout
 *
 * 先验证 ANSI 解析器能正确解析 Ink 输出。
 * 跑：node mouse-demo/intercept.js
 */
import React from "react";
import { render, Box, Text } from "ink";
import { PassThrough } from "node:stream";
import stringWidth from "string-width";
const h = React.createElement;

// 二维字符网格（支持宽字符：占多列，每列存同一字符）
class ScreenBuffer {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.cells = [];
    for (let r = 0; r < rows; r++) {
      this.cells.push(new Array(cols).fill(null).map(() => ({ char: " ", sgr: "", w: 1 })));
    }
    this.curR = 0; this.curC = 0; this.curSgr = "";
  }
  parse(data) {
    // 收集 UTF-8 字符（含多字节），按 code point 处理
    const chars = [...data];
    let i = 0;
    while (i < chars.length) {
      const ch = chars[i];
      if (ch === "\x1b") {
        if (chars[i + 1] === "[") {
          let j = i + 2;
          while (j < chars.length && !/[A-Za-z]/.test(chars[j])) j++;
          const cmd = chars[j];
          const params = chars.slice(i + 2, j).join("");
          if (cmd === "H" || cmd === "f") {
            const [r, c] = params.split(";").map((x) => parseInt(x) || 1);
            this.curR = r - 1; this.curC = c - 1;
          } else if (cmd === "m") {
            this.curSgr = params ? `\x1b[${params}m` : "";
          } else if (cmd === "J") {
            if (params === "2" || params === "") {
              for (let r = 0; r < this.rows; r++)
                for (let c = 0; c < this.cols; c++)
                  this.cells[r][c] = { char: " ", sgr: "", w: 1 };
              this.curR = 0; this.curC = 0;
            }
          } else if (cmd === "K") {
            for (let c = this.curC; c < this.cols; c++)
              this.cells[this.curR][c] = { char: " ", sgr: this.curSgr, w: 1 };
          }
          i = j + 1;
        } else { i++; }
      } else if (ch === "\n") { this.curR++; this.curC = 0; i++; }
      else if (ch === "\r") { this.curC = 0; i++; }
      else {
        const w = stringWidth(ch) || 1;
        if (this.curR >= 0 && this.curR < this.rows && this.curC >= 0 && this.curC < this.cols) {
          this.cells[this.curR][this.curC] = { char: ch, sgr: this.curSgr, w };
          // 宽字符占多列，后续列填同字符占位
          for (let k = 1; k < w && this.curC + k < this.cols; k++) {
            this.cells[this.curR][this.curC + k] = { char: ch, sgr: this.curSgr, w: 0 };
          }
        }
        this.curC += w;
        i++;
      }
    }
  }
  // 输出网格，选区内 cell 加蓝底（保留原前景色）
  toString(selCells) {
    let out = "\x1b[H";
    let lastSgr = "";
    for (let r = 0; r < this.rows; r++) {
      let line = "";
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        // 宽字符占位列（w===0）跳过，主列已输出
        if (cell.w === 0) continue;
        const inSel = selCells.has(`${r},${c}`);
        if (inSel) {
          // 保留原前景 SGR，追加蓝底（44）。先重置再设前景+蓝底，避免叠加
          line += `\x1b[0m${cell.sgr}\x1b[44m${cell.char}`;
        } else {
          // 只在 SGR 变化时输出（减少序列）
          if (cell.sgr !== lastSgr) { line += cell.sgr || "\x1b[0m"; lastSgr = cell.sgr; }
          line += cell.char;
        }
      }
      out += `\x1b[${r + 1};1H\x1b[0m${line}`;
      lastSgr = "";
    }
    return out;
  }
}

const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;
const sb = new ScreenBuffer(cols, rows);

// 虚拟 stdout 接收 Ink 输出
const fakeStdout = new PassThrough();
fakeStdout.isTTY = true;
fakeStdout.columns = cols;
fakeStdout.rows = rows;
fakeStdout.write = (chunk) => {
  const s = chunk.toString();
  sb.parse(s);
  return true;
};
fakeStdout.on = () => {};
fakeStdout.off = () => {};
fakeStdout.setRawMode = () => {};
fakeStdout.isRaw = false;
fakeStdout.ref = () => {};
fakeStdout.unref = () => {};
fakeStdout.resume = () => {};

// Ink 渲染到虚拟 stdout
const app = render(
  h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { color: "cyan" }, "拦截 stdout 全局蓝底 demo"),
    h(Text, null, "ABCDEFGHIJ"),
    h(Text, { color: "yellow" }, "中文测试 你好世界"),
    h(Box, { borderStyle: "single", paddingLeft: 1 }, h(Text, null, "框内文字")),
    h(Text, { color: "dim" }, "拖拽选字，Ctrl+C 复制，q 退出"),
  ),
  { stdout: fakeStdout, exitOnCtrlC: false, patchConsole: false }
);

// 真实 stdout 处理鼠标 + 输出
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write("\x1b[?1049h\x1b[H\x1b[2J\x1b[?1003h\x1b[?1006h");

let selAnchor = null, selFocus = null;
let dragArmed = false, dragStart = null;

function inSel(r, c) {
  if (!selAnchor || !selFocus) return false;
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  return r >= r1 && r <= r2 && (r > r1 || c >= c1) && (r < r2 || c <= c2);
}

function output() {
  const selCells = new Set();
  if (selAnchor && selFocus) {
    let r1, c1, r2, c2;
    if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
      r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
    } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
    for (let r = r1; r <= r2; r++) {
      const cs = r === r1 ? c1 : 0, ce = r === r2 ? c2 : cols - 1;
      for (let c = cs; c <= ce; c++) selCells.add(`${r},${c}`);
    }
  }
  process.stdout.write(sb.toString(selCells));
}

// 定期输出（Ink 渲染后）
setInterval(output, 100);

let pending = "";
process.stdin.on("data", (buf) => {
  let s = pending + buf.toString("latin1");
  if (s.includes("q") || s.includes("\x03")) {
    app.unmount();
    process.stdout.write("\x1b[?1006l\x1b[?1003l\x1b[?1049l");
    try { process.stdin.setRawMode(false); } catch {}
    process.exit(0);
  }
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    const b = parseInt(m[1], 10), c = parseInt(m[2], 10), r = parseInt(m[3], 10), type = m[4];
    const button = b & 3, isMotion = !!(b & 32);
    if (type === "M") {
      if (button === 0 && !isMotion) {
        dragArmed = true; dragStart = { col: c, row: r };
        selAnchor = null; selFocus = null;
      } else if (isMotion && dragArmed) {
        if (!selAnchor) selAnchor = { row: r, col: c };
        selFocus = { row: r, col: c };
      }
    } else if (type === "m") {
      dragArmed = false;
    }
    last = re.lastIndex;
  }
  pending = s.slice(last);
});

process.on("SIGINT", () => {
  app.unmount();
  process.stdout.write("\x1b[?1006l\x1b[?1003l\x1b[?1049l");
  try { process.stdin.setRawMode(false); } catch {}
  process.exit(0);
});
