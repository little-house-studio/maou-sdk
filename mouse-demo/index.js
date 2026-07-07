/**
 * 鼠标机制 demo v4 —— 验证"拖拽选区 + OSC52 复制"完整链路。
 *
 * 纯 node（不用 Ink），自己渲染，坐标完全已知。用和 maou 相同的 screenBuffer 逻辑：
 * 按 code point 分割 + string-width 算宽 + soft-wrap 视觉行登记。
 *
 * 流程：
 * 1. 渲染固定文本到备用屏（每行起始坐标已知）
 * 2. 登记 screenBuffer（row,col → char）
 * 3. 开 ?1003 全追踪
 * 4. 拖拽 → 反色选区（重绘选区内字符加 \x1b[7m）
 * 5. 松手 → extractSelection 提取文本 → OSC52 写剪贴板
 *
 * 跑：node mouse-demo/index.js
 * Ctrl+C 退出。
 *
 * 测试：拖拽选一段文字 → 松手 → 去 Cmd+V 粘贴，看是否是选中的内容。
 */
import stringWidth from "string-width";

const ESC = "\x1b";
const enterAlt = `${ESC}[?1049h`;
const exitAlt = `${ESC}[?1049l`;
const hideCursor = `${ESC}[?25l`;
const showCursor = `${ESC}[?25h`;
const mouseOn = `${ESC}[?1003h${ESC}[?1006h`;
const mouseOff = `${ESC}[?1006l${ESC}[?1003l`;

const TEXT_LINES = [
  "这是第一行可选择的文字 hello world 你好世界。",
  "第二行 The quick brown fox jumps over the lazy dog.",
  "第三行 拖拽选我试试 松手后自动复制到剪贴板。",
  "第四行 混合中文 abc 123 emoji 😎🎉 测试宽字符。",
  "第五行 这是一行非常长的文字用来测试 soft-wrap 当终端宽度不够时它会自动折到第二视觉行你点折行后的字符看看能不能选中 ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "第六行 结束。",
];

// ── screenBuffer（和 maou cli/src/input/screen-buffer.ts 同逻辑）──
const grid = new Map(); // "row,col" → char
function extractSelection(start, end) {
  let r1, c1, r2, c2;
  if (start.row < end.row || (start.row === end.row && start.col <= end.col)) {
    r1 = start.row; c1 = start.col; r2 = end.row; c2 = end.col;
  } else { r1 = end.row; c1 = end.col; r2 = start.row; c2 = start.col; }
  const lines = [];
  for (let r = r1; r <= r2; r++) {
    const colStart = r === r1 ? c1 : 1;
    const colEnd = r === r2 ? c2 : 9999;
    const chars = [];
    let last = null;
    for (let c = colStart; c <= colEnd; c++) {
      const ch = grid.get(`${r},${c}`);
      if (ch === undefined) { if (last !== null) { chars.push(last); last = null; } continue; }
      if (last !== null && last !== ch) chars.push(last);
      last = ch;
    }
    if (last !== null) chars.push(last);
    lines.push(chars.join(""));
  }
  return lines.join("\n");
}

// ── 渲染状态 ──
let selAnchor = null, selFocus = null;
let lastFeedback = "";

// 计算每行渲染位置（左侧 padding=1，顶部从第 2 行开始，第 1 行是标题）
const LEFT = 1;
const TOP_START = 2;
let availWidth = 80;

/** 把文本按 availWidth 拆成视觉行字符串数组（考虑宽字符） */
function wrapToVisualLines(text, availWidth) {
  const chars = [...text];
  const lines = [];
  let buf = "", lineUsed = 0;
  for (const ch of chars) {
    const w = stringWidth(ch) || 1;
    if (lineUsed + w > availWidth && lineUsed > 0) {
      lines.push(buf);
      buf = ""; lineUsed = 0;
    }
    buf += ch; lineUsed += w;
  }
  if (buf) lines.push(buf);
  return lines;
}

function renderAll() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(`${ESC}[1;1H╭─ 鼠标选区 demo v4（拖拽选字 松手自动复制 · Ctrl+C 退出）─╮`);
  let row = TOP_START;
  grid.clear();
  for (const line of TEXT_LINES) {
    const visLines = wrapToVisualLines(line, availWidth);
    for (const vl of visLines) {
      // 登记这一视觉行到 grid
      let col = LEFT;
      for (const ch of [...vl]) {
        const w = stringWidth(ch) || 1;
        for (let k = 0; k < w; k++) grid.set(`${row},${col + k}`, ch);
        col += w;
      }
      // 渲染
      process.stdout.write(`${ESC}[${row};${LEFT}H${vl}`);
      row++;
    }
  }
  // 状态行
  process.stdout.write(`${ESC}[${row + 1};1H${lastFeedback}`);
  process.stdout.write(`${ESC}[${row + 2};1Hsel: ${selAnchor ? `${selAnchor.row},${selAnchor.col}` : "null"} → ${selFocus ? `${selFocus.row},${selFocus.col}` : "null"} grid:${grid.size}`);
}

function renderSelection() {
  if (!selAnchor || !selFocus) return;
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  for (let r = r1; r <= r2; r++) {
    const colStart = r === r1 ? c1 : 1;
    const colEnd = r === r2 ? c2 : 9999;
    let buf = "";
    let col = colStart;
    for (let c = colStart; c <= colEnd; c++) {
      const ch = grid.get(`${r},${c}`);
      if (ch === undefined) { buf += " "; continue; }
      buf += `${ESC}[7m${ch}${ESC}[0m`;
    }
    process.stdout.write(`${ESC}[${r};${colStart}H${buf}`);
  }
}

function osc52(text) {
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `${ESC}]52;c;${b64}\x07`;
}

// ── 鼠标处理 ──
const EVT_RE = /\x1b\[<\d+;\d+;\d+[Mm]/g;
const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

let dragArmed = false;
let dragStart = null;

function handleEvent(evtStr) {
  const m = SGR_RE.exec(evtStr);
  if (!m) return;
  const b = parseInt(m[1], 10);
  const c = parseInt(m[2], 10);
  const r = parseInt(m[3], 10);
  const type = m[4];
  const button = b & 3;
  const isMotion = !!(b & 32);

  if (type === "M") {
    if (button === 0 && !isMotion) {
      // 左键按下
      dragArmed = true;
      dragStart = { col: c, row: r };
      selAnchor = null; selFocus = null;
      renderAll();
    } else if (isMotion && dragArmed && dragStart) {
      const dc = c - dragStart.col, dr = r - dragStart.row;
      if (dc * dc + dr * dr > 2 && !selAnchor) {
        selAnchor = { row: dragStart.row, col: dragStart.col };
      }
      if (selAnchor) {
        selFocus = { row: r, col: c };
        // 不在 motion 时重绘（反色暂未实现 + 避免闪烁）；松手时统一处理
      }
    }
  } else if (type === "m") {
    // 释放
    if (selAnchor && selFocus) {
      const text = extractSelection(selAnchor, selFocus);
      if (text && text.trim()) {
        process.stdout.write(osc52(text));
        lastFeedback = `已复制 ${text.length} 字: "${text.slice(0, 40)}" | sel ${selAnchor.row},${selAnchor.col}→${selFocus.row},${selFocus.col}`;
      } else {
        lastFeedback = `选区为空 | sel ${selAnchor.row},${selAnchor.col}→${selFocus.row},${selFocus.col}`;
      }
    }
    dragArmed = false; dragStart = null;
    selAnchor = null; selFocus = null;
    renderAll();
  }
}

// ── 初始化 ──
process.stdin.setRawMode(true);
process.stdin.resume();
// 用终端实际宽度
if (process.stdout.columns) availWidth = process.stdout.columns - LEFT;
renderAll();
process.stdout.write(hideCursor + mouseOn);

let pending = "";
process.stdin.on("data", (chunk) => {
  let s = pending + chunk.toString("latin1");
  if (s.includes("\x03")) { cleanup(); process.exit(0); }
  EVT_RE.lastIndex = 0;
  let last = 0, m;
  while ((m = EVT_RE.exec(s))) {
    handleEvent(m[0]);
    last = EVT_RE.lastIndex;
  }
  pending = s.slice(last);
});

function cleanup() {
  process.stdout.write(mouseOff + showCursor + exitAlt);
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });
