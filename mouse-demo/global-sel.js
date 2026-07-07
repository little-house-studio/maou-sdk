/**
 * 全局蓝底自渲染 demo —— 整个屏幕字符网格，选区内所有字符（含空格）蓝底。
 *
 * 纯 node，不用 Ink。自己维护二维字符网格（rows x cols），每格一个字符。
 * 选区进行时，选区内格子重绘为蓝底白字（ESC[97;44m）。
 * 松手保留选区，Ctrl+C 复制 + 双击退出。
 *
 * 跑：node mouse-demo/global-sel.js
 * q 退出。
 */
const ESC = "\x1b";
const SEL = `${ESC}[97;44m`; // 白字蓝底
const RESET = `${ESC}[0m`;

const LAYOUT = [
  "Ink 精确坐标 demo · 全局蓝底选区",
  "ABCDEFGHIJ",
  "中文测试你好世界",
  "emoji 😎🎉 测试",
  "长行测试这是一行非常非常长的文字用来测试soft-wrap当终端宽度不够时它会自动折到第二视觉行你点折行后的字符看看能不能命中ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "── 嵌套测试 ──",
  "┌────────────────────────────────────────────────────────────────────────────┐",
  "│ 框内文字                                                                   │",
  "└────────────────────────────────────────────────────────────────────────────┘",
  "   缩进三格",
  "",
  "拖拽选字（全局蓝底）· Ctrl+C 复制/双击退出 · Esc 清除 · q 退出",
];

let cols = 80, rows = 24;
// 二维字符网格：grid[row][col] = char（按视觉宽度，宽字符占多列）
const grid = []; // grid[row] = 数组，每元素 {ch, w} 或空格
let lineMap = []; // lineMap[row] = {text, startCol}

function charW(ch) {
  const c = ch.codePointAt(0);
  if (c > 0x7f && c < 0x10000) return 2;
  if (c >= 0x1f300) return 2; // emoji
  return 1;
}

function buildGrid() {
  grid.length = 0;
  for (let r = 0; r < rows; r++) {
    grid.push(new Array(cols).fill(" "));
  }
  for (let i = 0; i < LAYOUT.length && i < rows; i++) {
    let text = LAYOUT[i];
    let col = 0;
    for (const ch of [...text]) {
      if (ch === "\n") break;
      const w = charW(ch);
      if (col + w > cols) { // soft-wrap
        i++; if (i >= rows) break;
        col = 0;
      }
      for (let k = 0; k < w; k++) {
        if (i < rows && col < cols) grid[i][col] = { ch, w, main: k === 0 };
        col++;
      }
    }
  }
}

function getChar(r, c) {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return " ";
  const cell = grid[r][c];
  return typeof cell === "string" ? cell : cell.ch;
}

let selAnchor = null, selFocus = null;
let dragArmed = false, dragStart = null;
let hover = null;
let lastFeedback = "";
let ctrlCAt = 0, ctrlCTimer = null;

function inSel(r, c) {
  if (!selAnchor || !selFocus) return false;
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  if (r < r1 || r > r2) return false;
  if (r === r1 && c < c1) return false;
  if (r === r2 && c > c2) return false;
  return true;
}

function render() {
  let out = `${ESC}[H`;
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const ch = getChar(r, c);
      const isHover = hover && hover.row === r && hover.col === c;
      if (inSel(r, c)) {
        line += `${SEL}${ch}${RESET}`;
      } else if (isHover) {
        line += `${ESC}[7m${ch}${RESET}`;
      } else {
        line += ch;
      }
    }
    out += `${ESC}[${r + 1};1H${line}`;
  }
  if (lastFeedback) {
    out += `${ESC}[${rows};1H${ESC}[2K${lastFeedback.slice(0, cols - 1)}`;
  }
  process.stdout.write(out);
}

function extractSel() {
  if (!selAnchor || !selFocus) return "";
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  const lines = [];
  for (let r = r1; r <= r2; r++) {
    const cs = r === r1 ? c1 : 0, ce = r === r2 ? c2 : cols - 1;
    let line = "";
    for (let c = cs; c <= ce; c++) line += getChar(r, c);
    lines.push(line);
  }
  return lines.join("\n");
}

function osc52(text) {
  return `${ESC}]52;c;${Buffer.from(text, "utf-8").toString("base64")}${ESC}\\`;
}

function handleCtrlC() {
  const now = Date.now();
  if (selAnchor && selFocus) {
    const text = extractSel();
    if (text && text.trim()) {
      process.stdout.write(osc52(text));
      lastFeedback = `已复制 ${text.length} 字（Cmd+V 粘贴）`;
    }
    selAnchor = null; selFocus = null;
    ctrlCAt = now;
    render();
    return;
  }
  if (now - ctrlCAt < 3000) {
    if (ctrlCTimer) clearTimeout(ctrlCTimer);
    process.stdout.write(`${ESC}[?1006l${ESC}[?1003l${ESC}[?1049l`);
    try { process.stdin.setRawMode(false); } catch {}
    process.exit(0);
  } else {
    ctrlCAt = now;
    lastFeedback = "再按一次 Ctrl+C 退出";
    render();
    if (ctrlCTimer) clearTimeout(ctrlCTimer);
    ctrlCTimer = setTimeout(() => {
      if (Date.now() - ctrlCAt >= 2900) { lastFeedback = ""; render(); }
    }, 3000);
  }
}

// 初始化
process.stdin.setRawMode(true);
process.stdin.resume();
cols = process.stdout.columns || 80;
rows = process.stdout.rows || 24;
buildGrid();
process.stdout.write(`${ESC}[?1049h${ESC}[H${ESC}[2J${ESC}[?1003h${ESC}[?1006h`);
render();

let pending = "";
process.stdin.on("data", (buf) => {
  let s = pending + buf.toString("latin1");
  if (s.includes("q")) { cleanup(); process.exit(0); }
  if (s.includes("\x03")) { handleCtrlC(); return; }
  if (/^\x1b(?!\[|<|\])/.test(s)) { selAnchor = null; selFocus = null; lastFeedback = "选区已清除"; render(); }
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    const b = parseInt(m[1], 10), c = parseInt(m[2], 10), r = parseInt(m[3], 10), type = m[4];
    const button = b & 3, isMotion = !!(b & 32);
    if (type === "M") {
      if (button === 0 && !isMotion) {
        dragArmed = true; dragStart = { col: c, row: r };
        selAnchor = null; selFocus = null; render();
      } else if (isMotion) {
        if (dragArmed && dragStart) {
          if (!selAnchor && (c !== dragStart.col || r !== dragStart.row)) selAnchor = { row: dragStart.row, col: dragStart.col };
          if (selAnchor) { selFocus = { row: r, col: c }; render(); }
        } else {
          hover = { row: r, col: c }; render();
        }
      }
    } else if (type === "m") {
      if (selAnchor && selFocus) {
        lastFeedback = `选区已保留（${extractSel().length} 字）· Ctrl+C 复制 · Esc 清除`;
      }
      dragArmed = false; dragStart = null; render();
    }
    last = re.lastIndex;
  }
  pending = s.slice(last);
});

function cleanup() {
  process.stdout.write(`${ESC}[?1006l${ESC}[?1003l${ESC}[?1049l`);
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });
