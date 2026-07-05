/**
 * 鼠标机制 demo v3 —— 自画选区 + OSC52，不切换模式。
 *
 * 始终开 ?1003 全追踪：
 * - hover 按钮 → 反色高亮
 * - 点击按钮 → 状态反馈
 * - 按住左键拖拽 → 程序自画反色选区（不关协议）
 * - 松手 → OSC52 写选区文本到剪贴板（你测过 OSC52 可用）
 *
 * 选区文本提取：本 demo 用"屏幕字符网格缓存"——
 * 渲染时把每行字符存到 screenBuffer[row][col]，松手时按选区行列范围提取。
 * maou TUI 里要建立 Ink 渲染 → screenBuffer 的映射（较复杂，但 demo 先验证机制）。
 *
 * 跑：node mouse-demo/index.js   （覆盖 v2）
 * Ctrl+C 退出。
 */
const ESC = "\x1b";
const enterAlt = `${ESC}[?1049h`;
const exitAlt = `${ESC}[?1049l`;
const hideCursor = `${ESC}[?25l`;
const showCursor = `${ESC}[?25h`;
const mouseOn = `${ESC}[?1003h${ESC}[?1006h`;
const mouseOff = `${ESC}[?1006l${ESC}[?1003l`;

const BUTTONS = [
  { label: "[按钮A]", col: 1, action: "A" },
  { label: "[按钮B]", col: 12, action: "B" },
];
const TEXT_LINES = [
  "这是第一行可选择的文字 hello world 你好世界。",
  "第二行 The quick brown fox jumps over the lazy dog.",
  "第三行 拖拽选我试试 松手后自动复制到剪贴板。",
  "第四行 混合中文 abc 123 emoji 测试宽字符。",
  "第五行 再点一下按钮 A 或 B 看 hover 高亮。",
  "第六行 结束。",
];

// 屏幕字符网格缓存：screenBuffer[row] = 字符串（含宽字符，按视觉列对齐）
// 为简化，demo 用字符串数组，选区按"行 + 视觉列"提取（宽字符按 2 列）
const screenBuffer = [];

let hoverBtn = -1;
let eventCount = 0;
let lastMouse = { col: 0, row: 0, type: "" };
let mode = "track";
let dragArmed = false;
let dragStart = null;
let selAnchor = null;   // {row, col} 选区起点
let selFocus = null;    // {row, col} 选区终点（随拖动变）
let lastStatusDraw = 0;
let lastFeedback = "";

function buildScreenBuffer() {
  screenBuffer.length = 0;
  // 行1 标题
  screenBuffer.push("╭─ 鼠标机制 demo v3 自画选区+OSC52（Ctrl+C 退出）─╮");
  // 行2 按钮（去掉 ANSI 码的纯文本，便于选区提取）
  let btnLine = "";
  for (const b of BUTTONS) { while (btnLine.length < b.col) btnLine += " "; btnLine += b.label; }
  screenBuffer.push(btnLine);
  // 行3-8 文字
  for (const t of TEXT_LINES) screenBuffer.push(t);
  // 行9 状态（选区不覆盖这里，但缓存留空）
  screenBuffer.push("");
  // 行10 提示
  screenBuffer.push("拖拽文字区自动复制 点按钮看高亮 hover 看坐标");
}

function drawInitial() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  for (let i = 0; i < screenBuffer.length; i++) {
    process.stdout.write(`${ESC}[${i + 1};1H${screenBuffer[i]}`);
  }
  drawButtons();
  drawStatus();
}

function drawButtons() {
  let line = "";
  for (let i = 0; i < BUTTONS.length; i++) {
    const b = BUTTONS[i];
    while (line.length < b.col) line += " ";
    const isHover = hoverBtn === i;
    if (isHover) line += `${ESC}[7m${b.label}${ESC}[0m`;
    else line += b.label;
  }
  process.stdout.write(`${ESC}[2;1H${ESC}[2K${line}`);
}

function drawStatus() {
  const sel = selAnchor && selFocus ? ` 选区:${selAnchor.row},${selAnchor.col}→${selFocus.row},${selFocus.col}` : "";
  const status = `事件:${eventCount} 鼠标:${lastMouse.col},${lastMouse.row} ${lastMouse.type} 模式:${mode} hover:${hoverBtn}${sel} ${lastFeedback}`;
  process.stdout.write(`${ESC}[9;1H${ESC}[2K${status.slice(0, 80)}`);
}

// 选区反色重绘：重绘行3-8（文字区），选区内的字符加反色
function drawSelection() {
  if (!selAnchor || !selFocus) return;
  // 规范化选区：起点≤终点
  const r1 = Math.min(selAnchor.row, selFocus.row);
  const r2 = Math.max(selAnchor.row, selFocus.row);
  const c1 = (r1 === selAnchor.row) ? selAnchor.col : selFocus.col;
  const c2 = (r1 === selAnchor.row) ? selFocus.col : selAnchor.col;
  // 重绘涉及的行
  for (let r = r1; r <= r2; r++) {
    const lineIdx = r - 1; // screenBuffer 0-based，屏幕 1-based
    const line = screenBuffer[lineIdx];
    if (!line) continue;
    let out = "";
    let col = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      // 简化：ASCII=1列，其他按 1 列（demo 不严格处理宽字符，maou 里用 string-width）
      const inSel = (r > r1 || col >= c1) && (r < r2 || col <= c2);
      if (inSel) out += `${ESC}[7m${ch}${ESC}[0m`;
      else out += ch;
      col++;
    }
    process.stdout.write(`${ESC}[${r};1H${ESC}[2K${out}`);
  }
}

// 从 screenBuffer 提取选区文本
function extractSelection() {
  if (!selAnchor || !selFocus) return "";
  const r1 = Math.min(selAnchor.row, selFocus.row);
  const r2 = Math.max(selAnchor.row, selFocus.row);
  const c1 = (r1 === selAnchor.row) ? selAnchor.col : selFocus.col;
  const c2 = (r1 === selAnchor.row) ? selFocus.col : selAnchor.col;
  const parts = [];
  for (let r = r1; r <= r2; r++) {
    const line = screenBuffer[r - 1] ?? "";
    // 简化按字符索引切（demo 不严格处理宽字符列）
    parts.push(line.slice(Math.min(c1, line.length), Math.min(c2 + 1, line.length)));
  }
  return parts.join("\n");
}

function osc52(text) {
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `${ESC}]52;c;${b64}\x07`;
}

const EVT_RE = /\x1b\[<\d+;\d+;\d+[Mm]/g;
const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

function handleEvent(evtStr) {
  const m = SGR_RE.exec(evtStr);
  if (!m) return;
  eventCount++;
  const b = parseInt(m[1], 10);
  const c = parseInt(m[2], 10);
  const r = parseInt(m[3], 10);
  const type = m[4];
  const button = b & 3;
  const isMotion = !!(b & 32);
  lastMouse = { col: c, row: r, type: type === "M" ? (isMotion ? "drag" : "down") : "up" };

  if (type === "M") {
    if (button === 0 && !isMotion) {
      // 左键按下
      dragArmed = true;
      dragStart = { col: c, row: r };
      selAnchor = null;
      selFocus = null;
      // 若之前有选区，清掉重绘
      drawInitial();
    } else if (isMotion) {
      if (dragArmed && dragStart) {
        const dc = c - dragStart.col;
        const dr = r - dragStart.row;
        if (dc * dc + dr * dr > 2 && !selAnchor) {
          // 开始选区
          selAnchor = { row: dragStart.row, col: dragStart.col };
        }
        if (selAnchor) {
          selFocus = { row: r, col: c };
          drawSelection();
        }
      } else {
        // hover（没按住左键的 motion）
        let newHover = -1;
        if (r === 2) {
          for (let i = 0; i < BUTTONS.length; i++) {
            const bb = BUTTONS[i];
            if (c >= bb.col && c < bb.col + bb.label.length) { newHover = i; break; }
          }
        }
        if (newHover !== hoverBtn) {
          hoverBtn = newHover;
          drawButtons();
        }
      }
    }
  } else if (type === "m") {
    // 释放
    if (dragArmed && dragStart && !selAnchor && dragStart.row === 2) {
      // 短按按钮
      for (let i = 0; i < BUTTONS.length; i++) {
        const bb = BUTTONS[i];
        if (dragStart.col >= bb.col && dragStart.col < bb.col + bb.label.length) {
          lastFeedback = `点击 ${bb.action}`;
        }
      }
    }
    if (selAnchor && selFocus) {
      // 选区结束 → OSC52 复制
      const text = extractSelection();
      if (text) {
        process.stdout.write(osc52(text));
        lastFeedback = `已复制 ${text.length} 字`;
      }
    }
    dragArmed = false;
    dragStart = null;
  }
  const now = Date.now();
  if (now - lastStatusDraw > 30) { drawStatus(); lastStatusDraw = now; }
}

// 初始化
buildScreenBuffer();
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(enterAlt + hideCursor + mouseOn);
drawInitial();

let pending = "";
process.stdin.on("data", (chunk) => {
  let s = pending + chunk.toString("latin1");
  if (s.includes("\x03")) { cleanup(); process.exit(0); }
  EVT_RE.lastIndex = 0;
  let last = 0;
  let m;
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
