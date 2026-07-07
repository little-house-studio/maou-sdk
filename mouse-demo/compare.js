/**
 * 鼠标方案对比 demo —— 4 种模式运行时切换，复现 Claude Code 体感。
 *
 * 模式（按数字键切换）：
 *  1 = ?1003 全追踪 + 程序自画蓝底选区 + OSC52（Claude Code Fullscreen 路线）
 *  2 = ?1002 按钮拖动 + 程序自画蓝底选区 + OSC52（不报 hover）
 *  3 = ?1000 点击 + 拖拽时临时关协议让终端原生选区（松手恢复）
 *  4 = 不开鼠标协议（终端原生选区，无 hover/点击，对照基准）
 *
 * 全屏从 (1,1) 起，坐标无需校准。
 * 跑：node mouse-demo/compare.js
 * q / Ctrl+C 退出。
 *
 * 详见 SPEC.md
 */
import stringWidth from "string-width";

const ESC = "\x1b";
const enterAlt = `${ESC}[?1049h`;
const exitAlt = `${ESC}[?1049l`;
const showCursor = `${ESC}[?25h`;

// 鼠标模式序列
const MODE_SEQ = {
  1: { on: `${ESC}[?1003h${ESC}[?1006h`, off: `${ESC}[?1006l${ESC}[?1003l`, name: "?1003 全追踪+自画蓝底" },
  2: { on: `${ESC}[?1002h${ESC}[?1006h`, off: `${ESC}[?1006l${ESC}[?1002l`, name: "?1002 拖动+自画蓝底" },
  3: { on: `${ESC}[?1000h${ESC}[?1006h`, off: `${ESC}[?1006l${ESC}[?1000l`, name: "?1000 临时切换原生" },
  4: { on: "", off: "", name: "无鼠标协议（原生选区）" },
};

const BUTTONS = [
  { label: "[选项 A]", col: 1, action: "A" },
  { label: "[选项 B]", col: 14, action: "B" },
  { label: "[选项 C]", col: 27, action: "C" },
];
const TEXT_LINES = [
  "这是第一行对话内容 hello world 你好世界。",
  "第二行：The quick brown fox jumps over the lazy dog.",
  "第三行：拖拽选我试试，松手自动复制到剪贴板。",
  "第四行：混合中文 abc 123 emoji 😎🎉 测试宽字符。",
  "第五行：这是一行非常长的文字用来测试 soft-wrap 当终端宽度不够时它会自动折到第二视觉行你点折行后的字符看看能不能选中 ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "第六行：按 1/2/3/4 切换模式，q 退出。",
];

// screenBuffer
const grid = new Map();
function wrapLines(text, w) {
  const chars = [...text]; const out = []; let buf = "", used = 0;
  for (const ch of chars) {
    const cw = stringWidth(ch) || 1;
    if (used + cw > w && used > 0) { out.push(buf); buf = ""; used = 0; }
    buf += ch; used += cw;
  }
  if (buf) out.push(buf);
  return out;
}
function extractSel(start, end) {
  let r1, c1, r2, c2;
  if (start.row < end.row || (start.row === end.row && start.col <= end.col)) {
    r1 = start.row; c1 = start.col; r2 = end.row; c2 = end.col;
  } else { r1 = end.row; c1 = end.col; r2 = start.row; c2 = start.col; }
  const lines = [];
  for (let r = r1; r <= r2; r++) {
    const cs = r === r1 ? c1 : 1, ce = r === r2 ? c2 : 9999;
    const chars = []; let last = null;
    for (let c = cs; c <= ce; c++) {
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
function osc52(text) {
  return `${ESC}]52;c;${Buffer.from(text, "utf-8").toString("base64")}\x07`;
}

// 状态
let mode = 1;
let cols = 80, rows = 24;
let availWidth = 80;
let selAnchor = null, selFocus = null;
let dragArmed = false, dragStart = null;
let hoverBtn = -1;
let lastFeedback = "按 1/2/3/4 切换模式，拖拽文字选字";
let lastMouse = { col: 0, row: 0, type: "" };
let textEndRow = 0;

const SEL_BG = `${ESC}[97;44m`; // 亮白字蓝底
const RESET = `${ESC}[0m`;

function setMode(m) {
  // 关旧模式
  process.stdout.write(MODE_SEQ[mode].off);
  mode = m;
  // 开新模式
  process.stdout.write(MODE_SEQ[m].on);
  selAnchor = null; selFocus = null; dragArmed = false; hoverBtn = -1;
  lastFeedback = `切换到模式 ${m}: ${MODE_SEQ[m].name}`;
  renderBase();
}

function renderBase() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(`${ESC}[1;1H鼠标方案对比 demo | 模式 ${mode}: ${MODE_SEQ[mode].name} | ${cols}x${rows}`);
  // 行2 按钮
  let btnLine = "";
  for (const b of BUTTONS) { while (btnLine.length < b.col) btnLine += " "; btnLine += b.label; }
  process.stdout.write(`${ESC}[2;1H${btnLine}`);
  // 行3+ 文字
  grid.clear();
  let row = 3;
  for (const line of TEXT_LINES) {
    for (const vl of wrapLines(line, availWidth)) {
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
  textEndRow = row - 1;
  renderStatus();
}

function renderStatus() {
  const sel = selAnchor && selFocus ? ` sel:${selAnchor.row},${selAnchor.col}→${selFocus.row},${selFocus.col}` : "";
  const status = `模式${mode} | 鼠标:${lastMouse.col},${lastMouse.row} ${lastMouse.type} | hover:${hoverBtn}${sel} | ${lastFeedback}`;
  process.stdout.write(`${ESC}[${rows};1H${ESC}[2K${status.slice(0, cols - 1)}`);
}

function renderOverlay() {
  // hover 按钮
  let btnLine = "";
  for (let i = 0; i < BUTTONS.length; i++) {
    const b = BUTTONS[i];
    while (btnLine.length < b.col) btnLine += " ";
    btnLine += hoverBtn === i ? `${ESC}[7m${b.label}${RESET}` : b.label;
  }
  process.stdout.write(`${ESC}[2;1H${btnLine}`);
  // 选区蓝底
  if (!selAnchor || !selFocus) return;
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  for (let r = r1; r <= r2; r++) {
    const cs = r === r1 ? c1 : 1, ce = r === r2 ? c2 : availWidth;
    let buf = "";
    for (let c = cs; c <= ce; c++) {
      const ch = grid.get(`${r},${c}`);
      buf += ch === undefined ? `${SEL_BG} ${RESET}` : `${SEL_BG}${ch}${RESET}`;
    }
    process.stdout.write(`${ESC}[${r};${cs}H${buf}`);
  }
}

const EVT_RE = /\x1b\[<\d+;\d+;\d+[Mm]/g;
const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

function handleEvent(evtStr) {
  const m = SGR_RE.exec(evtStr);
  if (!m) return;
  const b = parseInt(m[1], 10), c = parseInt(m[2], 10), r = parseInt(m[3], 10), type = m[4];
  const button = b & 3, isMotion = !!(b & 32);
  lastMouse = { col: c, row: r, type: type === "M" ? (isMotion ? "drag" : "down") : "up" };

  if (type === "M") {
    if (button === 0 && !isMotion) {
      dragArmed = true; dragStart = { col: c, row: r };
      selAnchor = null; selFocus = null;
      renderBase();
    } else if (isMotion) {
      if (dragArmed && dragStart) {
        const dc = c - dragStart.col, dr = r - dragStart.row;
        if (dc * dc + dr * dr > 1 || selAnchor) {
          if (!selAnchor) selAnchor = { row: dragStart.row, col: dragStart.col };
          selFocus = { row: r, col: c };
          renderBase(); renderOverlay();
        }
      } else if (mode === 1) {
        // hover（仅模式1 ?1003 报无按键 motion）
        let nh = -1;
        if (r === 2) {
          for (let i = 0; i < BUTTONS.length; i++) {
            const bb = BUTTONS[i];
            if (c >= bb.col && c < bb.col + bb.label.length) { nh = i; break; }
          }
        }
        if (nh !== hoverBtn) { hoverBtn = nh; renderBase(); renderOverlay(); }
      }
    }
  } else if (type === "m") {
    if (selAnchor && selFocus) {
      const text = extractSel(selAnchor, selFocus);
      if (text && text.trim()) {
        process.stdout.write(osc52(text));
        lastFeedback = `已复制 ${text.length} 字: "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"`;
      } else lastFeedback = "选区为空";
    } else if (dragArmed && dragStart && dragStart.row === 2) {
      for (const bb of BUTTONS) {
        if (dragStart.col >= bb.col && dragStart.col < bb.col + bb.label.length) {
          lastFeedback = `点击了 ${bb.action}`;
        }
      }
    }
    dragArmed = false; dragStart = null; selAnchor = null; selFocus = null;
    renderBase();
  }
  renderStatus();
}

// 初始化
process.stdin.setRawMode(true);
process.stdin.resume();
cols = process.stdout.columns || 80;
rows = process.stdout.rows || 24;
availWidth = cols;
process.stdout.write(`${enterAlt}${ESC}[H${ESC}[2J${showCursor}`);
setMode(1);

let pending = "";
process.stdin.on("data", (chunk) => {
  let s = pending + chunk.toString("latin1");
  // Ctrl+C 退出
  if (s.includes("\x03")) { cleanup(); process.exit(0); }

  // 用 EVT_RE 扫描，把"完整鼠标事件"和"键盘输入"分开
  // 完整鼠标事件 → handleEvent；间隙的非 ESC 文本 → 键盘；末尾 ESC 开头不完整 → pending
  EVT_RE.lastIndex = 0;
  let cursor = 0;
  let m;
  while ((m = EVT_RE.exec(s))) {
    // m.index 之前的文本（cursor..m.index）可能是键盘输入
    const between = s.slice(cursor, m.index);
    handleKeyboard(between);
    handleEvent(m[0]);
    cursor = EVT_RE.lastIndex;
  }
  // 剩余部分：检查是否是未完整的 ESC 序列
  const rest = s.slice(cursor);
  // 如果 rest 以 ESC 开头但不是完整序列，留 pending；否则当键盘处理
  if (rest && rest[0] === "\x1b" && !EVT_RE.test(rest)) {
    // 可能是未完整鼠标序列或功能键，留到下次（简化：小段才留）
    if (rest.length < 20) pending = rest;
    else { handleKeyboard(rest); pending = ""; }
  } else {
    handleKeyboard(rest);
    pending = "";
  }
  EVT_RE.lastIndex = 0;
});

function handleKeyboard(text) {
  for (const ch of text) {
    if (ch === "q") { cleanup(); process.exit(0); }
    if (ch >= "1" && ch <= "4" && !dragArmed) {
      setMode(parseInt(ch, 10));
    }
  }
}

function cleanup() {
  process.stdout.write(MODE_SEQ[mode].off + showCursor + exitAlt);
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });
