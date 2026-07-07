/**
 * 蓝底自画选区 demo —— 始终 ?1003，程序画蓝底选区，松手 OSC52 复制。
 *
 * 不关协议（松手能收到 release）：
 * - 始终开 ?1003?1006 → hover/点击/拖拽全程收事件
 * - 拖拽时程序自己画蓝底选区（ESC[30;44m 黑字蓝底，模仿终端原生选区配色）
 * - 松手 → extractSelection 提取文本 → OSC52 写剪贴板 → Cmd+V 能粘
 *
 * 全屏从 (1,1) 起，坐标无需校准。
 *
 * 跑：node mouse-demo/blue-sel.js
 * Ctrl+C 退出。
 *
 * 对比 Claude Code 体感：拖拽蓝底选区 + 松手 Cmd+C 复制 + hover/点击正常
 */
import stringWidth from "string-width";

const ESC = "\x1b";
const enterAlt = `${ESC}[?1049h`;
const exitAlt = `${ESC}[?1049l`;
const mouseOn = `${ESC}[?1003h${ESC}[?1006h`;
const mouseOff = `${ESC}[?1006l${ESC}[?1003l`;
// 蓝底黑字（模仿终端原生选区配色）
const SEL_ON = `${ESC}[30;44m`;
const SEL_OFF = `${ESC}[0m`;

const TEXT_LINES = [
  "这是第一行对话内容，hello world 你好世界。",
  "第二行：The quick brown fox jumps over the lazy dog.",
  "第三行：拖拽选我试试，松手后按 Cmd+V 粘贴。",
  "第四行：混合中文 abc 123 emoji 😎🎉 测试。",
  "第五行：选区应蓝底，和终端原生选区一样。",
  "第六行：松手后自动复制，hover/点击也正常。",
];

const BUTTONS = [
  { label: "[选项 A]", col: 1, action: "A" },
  { label: "[选项 B]", col: 14, action: "B" },
];

// screenBuffer
const grid = new Map(); // "row,col" → char
function wrapToVisualLines(text, availWidth) {
  const chars = [...text];
  const lines = [];
  let buf = "", lineUsed = 0;
  for (const ch of chars) {
    const w = stringWidth(ch) || 1;
    if (lineUsed + w > availWidth && lineUsed > 0) { lines.push(buf); buf = ""; lineUsed = 0; }
    buf += ch; lineUsed += w;
  }
  if (buf) lines.push(buf);
  return lines;
}
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

// 状态
let selAnchor = null, selFocus = null;
let dragArmed = false, dragStart = null;
let hoverBtn = -1;
let lastFeedback = "拖拽文字选字（蓝底），松手自动复制";
let availWidth = 80;
let textRowEnd = 0; // 文字区最后一行

function osc52(text) {
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `${ESC}]52;c;${b64}\x07`;
}

function renderBase() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(`${ESC}[1;1HClaude Code 体感 demo · 蓝底选区（Ctrl+C 退出）`);
  // 行2 按钮
  let btnLine = "";
  for (const b of BUTTONS) {
    while (btnLine.length < b.col) btnLine += " ";
    btnLine += b.label;
  }
  process.stdout.write(`${ESC}[2;1H${btnLine}`);
  // 行3+ 文字（含 soft-wrap 登记）
  grid.clear();
  let row = 3;
  for (const line of TEXT_LINES) {
    const visLines = wrapToVisualLines(line, availWidth);
    for (const vl of visLines) {
      let col = 1;
      for (const ch of [...vl]) {
        const w = stringWidth(ch) || 1;
        for (let k = 0; k < w; k++) grid.set(`${row},${col + k}`, ch);
        col += w;
      }
      process.stdout.write(`${ESC}[${row};1H${vl}`);
      row++;
    }
  }
  textRowEnd = row - 1;
  // 状态行
  process.stdout.write(`${ESC}[${row + 1};1H${lastFeedback}`);
}

/** 重画选区（蓝底）+ hover 按钮 */
function renderOverlay() {
  // 先重画按钮行（hover 高亮）
  let btnLine = "";
  for (let i = 0; i < BUTTONS.length; i++) {
    const b = BUTTONS[i];
    while (btnLine.length < b.col) btnLine += " ";
    if (hoverBtn === i) btnLine += `${ESC}[7m${b.label}${ESC}[0m`;
    else btnLine += b.label;
  }
  process.stdout.write(`${ESC}[2;1H${btnLine}`);
  // 重画文字区选区（蓝底）
  if (!selAnchor || !selFocus) return;
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  for (let r = r1; r <= r2; r++) {
    const colStart = r === r1 ? c1 : 1;
    const colEnd = r === r2 ? c2 : availWidth;
    let buf = "";
    for (let c = colStart; c <= colEnd; c++) {
      const ch = grid.get(`${r},${c}`);
      if (ch === undefined) { buf += `${SEL_ON} ${SEL_OFF}`; continue; }
      buf += `${SEL_ON}${ch}${SEL_OFF}`;
    }
    process.stdout.write(`${ESC}[${r};${colStart}H${buf}`);
  }
}

const EVT_RE = /\x1b\[<\d+;\d+;\d+[Mm]/g;
const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

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
      renderBase();
    } else if (isMotion) {
      if (dragArmed && dragStart) {
        // 拖拽选区
        const dc = c - dragStart.col, dr = r - dragStart.row;
        if (dc * dc + dr * dr > 1 || selAnchor) {
          if (!selAnchor) selAnchor = { row: dragStart.row, col: dragStart.col };
          selFocus = { row: r, col: c };
          renderBase();
          renderOverlay();
        }
      } else {
        // hover（无按键 motion）
        let newHover = -1;
        if (r === 2) {
          for (let i = 0; i < BUTTONS.length; i++) {
            const bb = BUTTONS[i];
            if (c >= bb.col && c < bb.col + bb.label.length) { newHover = i; break; }
          }
        }
        if (newHover !== hoverBtn) {
          hoverBtn = newHover;
          renderBase();
          renderOverlay();
        }
      }
    }
  } else if (type === "m") {
    // 释放
    if (selAnchor && selFocus) {
      const text = extractSelection(selAnchor, selFocus);
      if (text && text.trim()) {
        process.stdout.write(osc52(text));
        lastFeedback = `已复制 ${text.length} 字: "${text.slice(0, 30)}${text.length > 30 ? "..." : ""}" → Cmd+V 粘贴`;
      } else {
        lastFeedback = "选区为空";
      }
    } else if (dragArmed && dragStart && dragStart.row === 2) {
      // 短按按钮
      for (const bb of BUTTONS) {
        if (dragStart.col >= bb.col && dragStart.col < bb.col + bb.label.length) {
          lastFeedback = `点击了 ${bb.action}`;
        }
      }
    }
    dragArmed = false; dragStart = null;
    selAnchor = null; selFocus = null;
    renderBase();
  }
}

// 初始化
process.stdin.setRawMode(true);
process.stdin.resume();
const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;
availWidth = cols;
process.stdout.write(`${enterAlt}${ESC}[H${ESC}[2J${mouseOn}`);
renderBase();
process.stdout.write(`${ESC}[${rows};1H终端: ${cols}x${rows} | 全屏从 (1,1) 起`);

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
  process.stdout.write(mouseOff + exitAlt);
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });
