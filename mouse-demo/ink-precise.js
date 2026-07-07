/**
 * Ink 坐标精确对齐验证 —— useBoxMetrics 拿坐标，验证鼠标点击完全对齐。
 *
 * 用 Ink 渲染，SelectableText 用 useBoxMetrics 拿 {left, top, width, height}，
 * 累加父链得绝对坐标（1-based），登记 screenBuffer。鼠标点击反查，显示点中字符。
 *
 * 测试嵌套 Box（border + padding）下坐标是否对齐——这是之前偏移的根因。
 *
 * 跑：node mouse-demo/ink-precise.js
 * 点字符看"→ X"是否对得上。q 退出。
 */
import React from "react";
import { render, Box, Text, useStdout, useBoxMetrics } from "ink";
const h = React.createElement;

const grid = new Map(); // "row,col" → char
let nextId = 0;
globalThis.__diag = [];

function charAt(row, col) {
  // 未登记格子当空格（整个区域都可选，包括空白）
  return grid.get(`${row},${col}`) ?? { char: " ", id: -1 };
}

function charWidth(ch) {
  return ch.codePointAt(0) > 0x7f ? 2 : 1;
}

/** 按可用宽度把文本拆成视觉行，每视觉行 [[char, colOffset], ...] */
function wrapToVisualLines(text, availWidth) {
  const chars = [...text];
  const lines = [];
  let buf = [], used = 0;
  for (const ch of chars) {
    if (ch === "\n") { lines.push(buf); buf = []; used = 0; continue; }
    const w = charWidth(ch);
    if (used + w > availWidth && used > 0) { lines.push(buf); buf = []; used = 0; }
    buf.push([ch, used]); used += w;
  }
  if (buf.length) lines.push(buf);
  return lines;
}

function registerText(text, left, top, width, id) {
  // soft-wrap：按 width 拆视觉行，每视觉行登记到 top + 行偏移
  const visLines = wrapToVisualLines(text, width);
  for (let i = 0; i < visLines.length; i++) {
    for (const [ch, colOffset] of visLines[i]) {
      const w = charWidth(ch);
      for (let k = 0; k < w; k++) grid.set(`${top + i},${left + colOffset + k}`, { char: ch, id });
    }
  }
}

/** 累加父链 getComputedLeft/Top 得绝对坐标（0-based），+1 转 1-based */
function getAbsRect(node) {
  let left = 0, top = 0, width = 0, height = 0, first = true;
  let cur = node;
  while (cur) {
    if (!cur.yogaNode) break;
    const l = cur.yogaNode.getComputedLeft();
    const t = cur.yogaNode.getComputedTop();
    if (first) { width = cur.yogaNode.getComputedWidth(); height = cur.yogaNode.getComputedHeight(); first = false; }
    left += l; top += t;
    cur = cur.parentNode;
  }
  return { left: left + 1, top: top + 1, width, height }; // 0-based → 1-based
}

// 全局状态（不用 React state，避免重渲丢失鼠标事件处理）
let hoverCell = null; // {row, col, char} 当前 hover 的字符
let selAnchor = null, selFocus = null; // 选区起止
let dragArmed = false, dragStart = null;
let lastFeedback = "拖拽选字（蓝底）· Ctrl+C 复制/双击退出 · Esc 清除 · q 退出";
// Ctrl+C 双击退出（3秒窗口），第一次若有选区则复制+清选区
let ctrlCAt = 0;
let ctrlCTimer = null;
function handleCtrlC() {
  const now = Date.now();
  if (selAnchor && selFocus) {
    // 有选区：第一次 Ctrl+C 复制 + 清选区（不退出）
    const text = extractSelection();
    if (text && text.trim()) {
      process.stdout.write(osc52(text));
      lastFeedback = `已复制 ${text.length} 字（Cmd+V 粘贴）`;
    }
    selAnchor = null; selFocus = null;
    ctrlCAt = now;
    notify();
    return;
  }
  // 无选区：双击退出
  if (now - ctrlCAt < 3000) {
    if (ctrlCTimer) clearTimeout(ctrlCTimer);
    cleanup();
    process.exit(0);
  } else {
    ctrlCAt = now;
    lastFeedback = "再按一次 Ctrl+C 退出";
    notify();
    // 3 秒后提示自动消失
    if (ctrlCTimer) clearTimeout(ctrlCTimer);
    ctrlCTimer = setTimeout(() => {
      if (Date.now() - ctrlCAt >= 2900) {
        lastFeedback = "拖拽选字（蓝底）· Ctrl+C 复制/双击退出 · Esc 清除 · q 退出";
        notify();
      }
    }, 3000);
  }
}

let listeners = [];

function notify() { for (const l of listeners) l(); }
function subscribe(l) { listeners.push(l); return () => { listeners = listeners.filter(x => x !== l); }; }

function extractSelection() {
  if (!selAnchor || !selFocus) return "";
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  const lines = [];
  for (let r = r1; r <= r2; r++) {
    const cs = r === r1 ? c1 : 1, ce = r === r2 ? c2 : 9999;
    const chars = []; let last = null;
    for (let c = cs; c <= ce; c++) {
      const cell = grid.get(`${r},${c}`);
      const ch = cell ? cell.char : " "; // 未登记当空格
      if (last !== null && last !== ch) chars.push(last);
      last = ch;
    }
    if (last !== null) chars.push(last);
    lines.push(chars.join(""));
  }
  return lines.join("\n");
}

function inSelection(row, col) {
  if (!selAnchor || !selFocus) return false;
  let r1, c1, r2, c2;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row; c1 = selAnchor.col; r2 = selFocus.row; c2 = selFocus.col;
  } else { r1 = selFocus.row; c1 = selFocus.col; r2 = selAnchor.row; c2 = selAnchor.col; }
  if (row < r1 || row > r2) return false;
  if (row === r1 && col < c1) return false;
  if (row === r2 && col > c2) return false;
  return true;
}

function osc52(text) {
  return `\x1b]52;c;${Buffer.from(text, "utf-8").toString("base64")}\x07`;
}

function SelectableText(props) {
  const ref = React.useRef(null);
  const metrics = useBoxMetrics(ref);
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => subscribe(force), []);
  // metrics 变化时重新登记（布局完成/变化都会更新 metrics）
  React.useEffect(() => {
    if (!ref.current || !metrics.hasMeasured || metrics.width === 0) return;
    const rect = getAbsRect(ref.current);
    if (rect.width === 0) return;
    registerText(String(props.children), rect.left, rect.top, rect.width, nextId++);
    globalThis.__diag.push(`"${String(props.children).slice(0,8)}" abs=${rect.left},${rect.top} ${rect.width}x${rect.height}`);
  }, [metrics.hasMeasured, metrics.width, metrics.left, metrics.top, props.children]);
  // 按视觉行拆段渲染：每视觉行内合并同 style 字符为一段 Text
  // 这样长行 soft-wrap 也能显示选区蓝底/hover
  const text = String(props.children);
  const rect = ref.current ? getAbsRect(ref.current) : null;
  if (!rect) return h(Box, { ref }, h(Text, null, text));
  const visLines = wrapToVisualLines(text, rect.width); // [[char,colOffset],...]
  const lineEls = [];
  for (let li = 0; li < visLines.length; li++) {
    const line = visLines[li];
    // 算每个字符的 style
    const marks = [];
    for (const [ch, colOffset] of line) {
      const w = charWidth(ch);
      let style = null;
      for (let k = 0; k < w; k++) {
        const absRow = rect.top + li, absCol = rect.left + colOffset + k;
        if (inSelection(absRow, absCol)) { style = "sel"; break; }
        if (hoverCell && hoverCell.row === absRow && hoverCell.col === absCol) { style = "hover"; break; }
      }
      marks.push({ style, ch });
    }
    // 合并同 style 为段
    const segs = [];
    let curStyle = marks[0]?.style ?? null;
    let curText = marks[0] ? marks[0].ch : "";
    for (let i = 1; i < marks.length; i++) {
      if (marks[i].style === curStyle) curText += marks[i].ch;
      else { segs.push({ style: curStyle, text: curText }); curStyle = marks[i].style; curText = marks[i].ch; }
    }
    if (curText) segs.push({ style: curStyle, text: curText });
    const segEls = segs.map((s, i) => {
      if (s.style === "sel") return h(Text, { key: i, backgroundColor: "blue", color: "white" }, s.text);
      if (s.style === "hover") return h(Text, { key: i, inverse: true }, s.text);
      return h(Text, { key: i }, s.text);
    });
    lineEls.push(h(Box, { key: li }, ...segEls));
  }
  return h(Box, { ref, flexDirection: "column" }, ...lineEls);
}

function App() {
  const { stdout } = useStdout();
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => subscribe(force), []);
  const [diag, setDiag] = React.useState("(waiting)");
  const [samples, setSamples] = React.useState("");
  const [gridSize, setGridSize] = React.useState(0);

  React.useEffect(() => {
    if (!stdout) return;
    stdout.write("\x1b[?1049h\x1b[H\x1b[2J\x1b[?1003h\x1b[?1006h\x1b[?25h");
    try { process.stdin.setRawMode(true); } catch {}
    const handler = (buf) => {
      const s = buf.toString("latin1");
      if (s.includes("q")) { cleanup(); process.exit(0); }
      // Ctrl+C：有选区则复制+清，无选区则双击退出
      if (s.includes("\x03")) { handleCtrlC(); return; }
      // Esc 清选区
      if (/^\x1b(?!\[|<|\])/.test(s)) {
        selAnchor = null; selFocus = null; hoverCell = null;
        lastFeedback = "选区已清除";
        notify();
      }
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
      let m;
      while ((m = re.exec(s))) {
        const b = parseInt(m[1], 10), c = parseInt(m[2], 10), r = parseInt(m[3], 10), type = m[4];
        const button = b & 3, isMotion = !!(b & 32);
        if (type === "M") {
          if (button === 0 && !isMotion) {
            // 左键按下
            dragArmed = true; dragStart = { col: c, row: r };
            selAnchor = null; selFocus = null;
            notify();
          } else if (isMotion) {
            if (dragArmed && dragStart) {
              // 拖拽选区
              const dc = c - dragStart.col, dr = r - dragStart.row;
              if (dc * dc + dr * dr > 1 || selAnchor) {
                if (!selAnchor) selAnchor = { row: dragStart.row, col: dragStart.col };
                selFocus = { row: r, col: c };
                notify();
              }
            } else {
              // hover（无按键 motion）
              const hit = charAt(r, c);
              hoverCell = hit ? { row: r, col: c, char: hit.char } : null;
              notify();
            }
          }
        } else if (type === "m") {
          // 释放：保留蓝底选区，不自动复制。Ctrl+C 复制，Esc 清除
          if (selAnchor && selFocus) {
            lastFeedback = `选区已保留（${extractSelection().length} 字）· Ctrl+C 复制 · Esc 清除`;
          } else {
            const hit = charAt(r, c);
            lastFeedback = `点击 (${c},${r}) → ${hit ? `"${hit.char}"` : "空白"}`;
          }
          dragArmed = false; dragStart = null;
          notify();
        }
      }
    };
    process.stdin.on("data", handler);
    const id = setTimeout(() => {
      setDiag(globalThis.__diag[0] ?? "(no diag)");
      setGridSize(grid.size);
      const samples = [];
      for (let r = 2; r <= 4; r++) {
        for (let c = 2; c <= 5; c++) {
          const cell = charAt(r, c);
          if (cell) samples.push(`(${c},${r})=${cell.char}`);
        }
      }
      setSamples(samples.join(" "));
    }, 300);
    return () => { clearTimeout(id); process.stdin.off("data", handler); };
  }, [stdout]);

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { color: "cyan" }, "Ink 精确坐标 demo · 蓝底选区 + hover"),
    h(SelectableText, null, "ABCDEFGHIJ"),
    h(SelectableText, null, "中文测试你好世界"),
    h(SelectableText, null, "emoji 😎🎉 测试"),
    h(SelectableText, null, "长行测试这是一行非常非常长的文字用来测试soft-wrap当终端宽度不够时它会自动折到第二视觉行你点折行后的字符看看能不能命中ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    h(Text, { color: "dim" }, "── 嵌套 Box border+padding 测试 ──"),
    h(Box, { borderStyle: "single", paddingLeft: 1 },
      h(SelectableText, null, "框内文字"),
    ),
    h(Box, { paddingLeft: 3 },
      h(SelectableText, null, "缩进三格"),
    ),
    h(Box, { marginTop: 1 },
      h(Text, { color: "green" }, lastFeedback),
      h(Text, { color: "yellow" }, ` | grid:${gridSize}`),
    ),
    h(Text, { color: "magenta" }, diag.slice(0, 80)),
    h(Text, { color: "blue" }, samples.slice(0, 100)),
  );
}

function cleanup() {
  process.stdout.write("\x1b[?1006l\x1b[?1003l\x1b[?1049l");
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });

render(h(App, null), { exitOnCtrlC: false, patchConsole: false });
