/**
 * 显存提取方案 demo v4 —— fakeStdout + Output.write patch 双管齐下。
 *
 * 1. Ink render() 的 stdout 传 fakeStdout（不写真实终端，避免抢 stdout）
 * 2. monkey-patch Output.write 拦截结构化 (x,y,text)，不解析字符串
 * 3. 从 operations 建网格（含 SGR + 宽字符），注入选区蓝底/hover
 * 4. 输出到真实 stdout，严格 rows 行，每行视觉宽度 ≤ cols，不滚动
 *
 * 跑：node mouse-demo/vram.js
 * 拖拽选区 → 全局蓝底 · q 退出
 */
import React from "react";
import { render, Box, Text } from "ink";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import stringWidth from "string-width";
const h = React.createElement;

// 拿 Ink 内部 Output 类
const req = createRequire(import.meta.url);
const inkPath = req.resolve("ink");
const outputMod = req(inkPath.replace(/index\.js$/, "output.js"));
const OutputProto = outputMod.default.prototype;

// 选区状态
let selAnchor = null, selFocus = null;
let hover = { row: 0, col: 0 };
let dragArmed = false, dragStart = null;

function inSel(r, c) {
  if (!selAnchor || !selFocus) return false;
  const r0 = r - 1, c0 = c - 1;
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row - 1; c1 = selAnchor.col - 1; r2 = selFocus.row - 1; c2 = selFocus.col - 1;
  } else { r1 = selFocus.row - 1; c1 = selFocus.col - 1; r2 = selAnchor.row - 1; c2 = selAnchor.col - 1; }
  return r0 >= r1 && r0 <= r2 && (r0 > r1 || c0 >= c1) && (r0 < r2 || c0 <= c2);
}

// patch Output.get：拿 Ink 渲染结果字符串（含 SGR），存到 lastInkOutput
let lastInkOutput = "";
const origGet = OutputProto.get;
OutputProto.get = function () {
  const result = origGet.call(this);
  lastInkOutput = result.output;
  return result;
};

// 虚拟 stdout（PassThrough 继承 EventEmitter，保留 on/off/emit 让 Ink 能监听 resize）
const fakeStdout = new PassThrough();
fakeStdout.isTTY = true;
fakeStdout.columns = process.stdout.columns || 80;
fakeStdout.rows = process.stdout.rows || 24;
fakeStdout.write = () => true;
fakeStdout.setRawMode = () => fakeStdout;
fakeStdout.isRaw = false;
fakeStdout.ref = () => fakeStdout;
fakeStdout.unref = () => fakeStdout;
fakeStdout.resume = () => fakeStdout;

/** 从 Ink 输出字符串（含 SGR + \n，无光标定位）建网格 */
function buildGrid(cols, rows) {
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(null).map(() => ({ ch: " ", sgr: "", w: 1 })));
  const lines = lastInkOutput.split("\n");
  for (let r = 0; r < Math.min(lines.length, rows); r++) {
    const line = lines[r];
    let sgr = "";
    let col = 0;
    const chars = [...line];
    let i = 0;
    while (i < chars.length && col < cols) {
      const ch = chars[i];
      if (ch === "\x1b" && chars[i + 1] === "[") {
        let j = i + 2;
        while (j < chars.length && !/[A-Za-z]/.test(chars[j])) j++;
        if (chars[j] === "m") {
          const params = chars.slice(i + 2, j).join("");
          sgr = params ? `\x1b[${params}m` : "\x1b[0m";
        }
        i = j + 1;
        continue;
      }
      const w = stringWidth(ch) || 1;
      if (col + w <= cols) {
        grid[r][col] = { ch, sgr, w };
        for (let k = 1; k < w; k++) grid[r][col + k] = { ch: "", sgr, w: 0 };
      }
      col += w;
      i++;
    }
  }
  return grid;
}

/** 输出网格到真实 stdout，选区蓝底/hover，严格 rows 行 */
function renderToRealStdout(cols, rows) {
  const grid = buildGrid(cols, rows);
  // 诊断行写进网格最后一行（按视觉宽度截断，不超 cols）
  const diag = `(${hover.col},${hover.row})`;
  let diagW = 0;
  const diagLine = [...diag].map(ch => {
    const w = stringWidth(ch) || 1;
    diagW += w;
    return { ch, w };
  }).filter(() => { const ok = diagW <= cols - 1; if (!ok) diagW -= stringWidth; return ok; });
  // 清空最后一行再写诊断
  for (let c = 0; c < cols; c++) grid[rows - 1][c] = { ch: " ", sgr: "\x1b[0m", w: 1 };
  let dc = 0;
  for (const ch of [...diag]) {
    const w = stringWidth(ch) || 1;
    if (dc + w >= cols) break;
    grid[rows - 1][dc] = { ch, sgr: "\x1b[0m", w };
    for (let k = 1; k < w; k++) grid[rows - 1][dc + k] = { ch: "", sgr: "", w: 0 };
    dc += w;
  }
  let out = "\x1b[H\x1b[?25l";
  for (let r = 0; r < rows; r++) {
    let line = "";
    let lastSgr = "\x1b[0m";
    let visW = 0;
    for (let c = 0; c < cols && visW < cols; c++) {
      const cell = grid[r][c];
      if (cell.w === 0) continue; // 宽字符占位列跳过
      const isHover = hover.row - 1 === r && hover.col - 1 >= c && hover.col - 1 < c + cell.w;
      if (inSel(r + 1, c + 1)) {
        line += `\x1b[0m${cell.sgr}\x1b[44m${cell.ch}\x1b[0m`;
        lastSgr = "\x1b[0m";
        visW += cell.w;
      } else if (isHover) {
        line += `\x1b[0m${cell.sgr}\x1b[7m${cell.ch}\x1b[0m`;
        lastSgr = "\x1b[0m";
        visW += cell.w;
      } else {
        if (cell.ch === " ") {
          if (lastSgr !== "\x1b[0m") { line += "\x1b[0m"; lastSgr = "\x1b[0m"; }
          line += " ";
        } else {
          if (cell.sgr !== lastSgr) { line += cell.sgr || "\x1b[0m"; lastSgr = cell.sgr; }
          line += cell.ch;
        }
        visW += cell.w;
      }
    }
    out += `\x1b[${r + 1};1H\x1b[K${line}`;
  }
  out += "\x1b[0m\x1b[?25l";
  process.stdout.write(out);
}

function App() {
  React.useEffect(() => {
    const real = process.stdout;
    let cols = real.columns || 80, rows = real.rows || 24;
    real.write(`\x1b[?1049h\x1b[H\x1b[2J\x1b[?1003h\x1b[?1006h\x1b[?25l`);
    try { process.stdin.setRawMode(true); } catch {}
    const handler = (buf) => {
      const s = buf.toString("latin1");
      if (s.includes("q") || s.includes("\x03")) { cleanup(); process.exit(0); }
      cols = real.columns || 80; rows = real.rows || 24;
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
      let m;
      while ((m = re.exec(s))) {
        const b = parseInt(m[1], 10), c = parseInt(m[2], 10), r = parseInt(m[3], 10), type = m[4];
        if (b & 64) continue; // 滚轮
        const button = b & 3, isMotion = !!(b & 32);
        if (type === "M") {
          if (button === 0 && !isMotion) {
            dragArmed = true; dragStart = { col: c, row: r };
            selAnchor = null; selFocus = null;
          } else if (isMotion) {
            if (dragArmed && dragStart) {
              if (!selAnchor) selAnchor = { row: dragStart.row, col: dragStart.col };
              selFocus = { row: r, col: c };
            } else { hover = { row: r, col: c }; }
          }
        } else if (type === "m") { dragArmed = false; }
      }
      renderToRealStdout(cols, rows);
    };
    process.stdin.on("data", handler);
    const id = setTimeout(() => renderToRealStdout(cols, rows), 200);
    const onResize = () => {
      const newCols = real.columns || 80, newRows = real.rows || 24;
      fakeStdout.columns = newCols;
      fakeStdout.rows = newRows;
      // 手动触发 resize 让 Ink 重布局（PassThrough 不自动发 resize 事件）
      fakeStdout.emit("resize", { cols: newCols, rows: newRows });
      real.write(`\x1b[2J\x1b[H`);
      setTimeout(() => renderToRealStdout(newCols, newRows), 150);
    };
    real.on("resize", onResize);
    return () => { clearTimeout(id); process.stdin.off("data", handler); real.off("resize", onResize); };
  }, []);
  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { color: "cyan" }, "显存提取 v4（拖拽选区全局蓝底 · q 退出）"),
    h(Text, null, "ABCDEFGHIJ"),
    h(Text, { color: "yellow" }, "中文测试 你好世界"),
    h(Text, null, "emoji 😎🎉 测试"),
    h(Box, { borderStyle: "single", paddingLeft: 1 }, h(Text, null, "框内文字")),
    h(Box, { borderStyle: "double", paddingX: 2 }, h(Text, { color: "green" }, "双边框 padding2")),
    h(Box, { gap: 2 },
      h(Text, { color: "red" }, "左"),
      h(Text, { color: "blue" }, "中"),
      h(Text, { color: "green" }, "右"),
    ),
    h(Box, { marginLeft: 4 }, h(Text, { color: "magenta" }, "缩进4")),
    h(Text, { color: "cyan", wrap: "wrap" }, "这是一段非常非常非常长的文字用来测试自动换行 wrap 当终端宽度不够时它应该自动折行到下一行你应该能选中折行后的内容包括中文和英文混排 abcdefghijklmnopqrstuvwxyz 1234567890 以及 emoji 😎🎉🎉😎 的折行测试看看效果如何如果还是不够长就再加一些文字直到能够触发多行换行为止这是一段非常长的测试文字"),
    h(Text, null, "混合 abc中文123😎🎉xyz测试"),
    h(Text, { color: "dim" }, "拖拽选区→全局蓝底 · hover 反色 · 颜色保留"),
  );
}

function cleanup() {
  OutputProto.get = origGet;
  process.stdout.write("\x1b[?1006l\x1b[?1003l\x1b[?1049l");
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });

render(h(App, null), { stdout: fakeStdout, exitOnCtrlC: false, patchConsole: false });
