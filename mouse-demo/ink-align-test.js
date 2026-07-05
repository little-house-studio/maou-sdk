/**
 * 路 A 可行性验证：Ink + 自维护 screenBuffer，鼠标坐标能否对齐 CJK/emoji/soft-wrap。
 *
 * 用 Ink 的 createElement（不写 JSX，避免编译依赖）。
 * 渲染：含 CJK、emoji、长行 soft-wrap、Box padding。
 * 维护 screenBuffer：每个 TrackedText 用 measureElement 拿屏幕矩形，登记字符。
 * 鼠标 ?1003，点击按 (col,row) 反查，显示点中字符。
 *
 * 跑：cd maou-sdk && node mouse-demo/ink-align-test.js
 * Ctrl+C 退出。
 *
 * 你肉眼对比：你点的字符 vs 程序识别的字符，对不对得上。
 */
import React from "react";
import { render, Box, Text, useStdout } from "ink";
const h = React.createElement;

const grid = new Map(); // `${row},${col}` → { char, nodeId }
const rects = [];
let nextNodeId = 0;
const clearGrid = () => { grid.clear(); rects.length = 0; };
const charAt = (row, col) => grid.get(`${row},${col}`) ?? null;
globalThis.__diag = [];

// 校准偏移：mouseOffset = (mouseCoord - registeredCoord)。
// 启动后第一次点击 A（ABCDEFGHIJ 的第一个字符）校准，之后所有鼠标坐标减去此偏移再查 grid。
let calib = null; // {dRow, dCol} 鼠标坐标 - 登记坐标

/**
 * 遍历 yogaNode 父链累加 getComputedLayout().left/top，算元素绝对屏幕坐标（1-based）。
 * Ink 7 的 measureElement 只返回 {width,height}，不返回位置，必须自己算。
 * 参考 maou cli/src/input/click-target.ts 的 getElementRect。
 */
function getElementRect(node) {
  if (!node) return null;
  let current = node;
  let left = 1, top = 1, width = 0, height = 0, first = true;
  while (current) {
    if (!current.yogaNode) break;
    const layout = current.yogaNode.getComputedLayout();
    if (first) { width = layout.width; height = layout.height; first = false; }
    left += layout.left;
    top += layout.top;
    current = current.parentNode;
  }
  return { left, top, width, height };
}

function registerText(text, rect, nodeId) {
  rects.push({ text, rect, nodeId });
  let col = rect.left;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    let w = 1;
    if (ch.codePointAt(0) > 0x7f) w = 2;
    for (let k = 0; k < w; k++) grid.set(`${rect.top},${col + k}`, { char: ch, nodeId });
    col += w;
  }
}

// TrackedText：渲染后用 getElementRect 登记（useEffect，useLayoutEffect 时 yogaNode 可能未布局）
function TrackedText(props) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    globalThis.__diag.push(`[enter effect] ref=${!!ref.current}`);
    if (!ref.current) return;
    const rect = getElementRect(ref.current);
    if (rect && rect.width > 0) {
      registerText(String(props.children), rect, nextNodeId++);
    }
    const node = ref.current;
    globalThis.__diag.push(`"${String(props.children).slice(0,6)}" rect=${rect ? `${rect.left},${rect.top} ${rect.width}x${rect.height}` : "null"} yoga=${!!node?.yogaNode}`);
  });
  // Box 支持 ref；Text 可能不 forward ref。用 Box 包裹
  return h(Box, { ref }, h(Text, null, props.children));
}

function App() {
  const { stdout } = useStdout();
  const [lastClick, setLastClick] = React.useState("先点 ABCDEFGHIJ 的 A 校准");
  const [gridSize, setGridSize] = React.useState(0);
  const [diag, setDiag] = React.useState("(waiting)");
  const [, force] = React.useReducer((x) => x + 1, 0);

  // 首次渲染后 force 一次，确保 measureElement 在布局完成后登记
  React.useEffect(() => {
    force();
    const id = setTimeout(() => {
      setGridSize(grid.size);
      const first = rects[0];
      setDiag(first ? `anchor "${first.text.slice(0,6)}" @ ${first.rect.left},${first.rect.top}` : "(no rect)");
    }, 200);
    return () => clearTimeout(id);
  }, []);

  React.useEffect(() => {
    if (!stdout) return;
    // 显式开 raw mode（Ink 没用 useInput 不会自动开；不开 raw 会 echo 鼠标序列致乱码）
    try { process.stdin.setRawMode(true); } catch {}
    process.stdin.resume();
    stdout.write("\x1b[?1003h\x1b[?1006h\x1b[?25l");
    // 直接监听原始 process.stdin（未剥离 SGR），拿鼠标事件
    const handler = (buf) => {
      const s = buf.toString("latin1");
      if (s.includes("\x03")) process.exit(0); // Ctrl+C
      const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
      let m;
      while ((m = re.exec(s))) {
        const b = parseInt(m[1], 10);
        const c = parseInt(m[2], 10);
        const r = parseInt(m[3], 10);
        const type = m[4];
        if (type === "M" && (b & 3) === 0) {
          if (!calib) {
            // 首次点击校准：假设你点的是 "ABCDEFGHIJ" 的 A（登记在 rects[0]）
            const a = rects[0];
            if (a) {
              // A 的登记坐标 (a.rect.left, a.rect.top)
              calib = { dRow: r - a.rect.top, dCol: c - a.rect.left };
              setLastClick(`校准完成 偏移=${calib.dRow},${calib.dCol}（你点的 ${r},${c} - A登记 ${a.rect.top},${a.rect.left}）`);
            } else {
              setLastClick(`(${c},${r}) 还没登记，等一下再点`);
            }
          } else {
            // 校准后：鼠标坐标减偏移，查 grid
            const gr = r - calib.dRow;
            const gc = c - calib.dCol;
            const hit = charAt(gr, gc);
            if (hit) setLastClick(`(${c},${r})→校准${gc},${gr}→ "${hit.char}" ✓`);
            else setLastClick(`(${c},${r})→校准${gc},${gr} 空白`);
          }
        }
      }
    };
    process.stdin.on("data", handler);
    return () => {
      process.stdin.off("data", handler);
      stdout.write("\x1b[?1006l\x1b[?1003l\x1b[?25h");
      try { process.stdin.setRawMode(false); } catch {}
    };
  }, [stdout]);

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Text, { color: "cyan" }, "Ink 坐标对齐测试（点字符看识别对不对 · Ctrl+C 退出）"),
    h(TrackedText, null, "ABCDEFGHIJ"),
    h(TrackedText, null, "中文测试你好世界"),
    h(TrackedText, null, "emoji 😎🎉 测试"),
    h(TrackedText, null, "mixed abc 中文 123 😎"),
    h(Text, { color: "dim" }, "── 长行 soft-wrap 测试（点折行后的字符看能否定位）──"),
    h(TrackedText, null, "这是一行非常非常长的文字用来测试soft-wrap当终端宽度不够时它会自动折到第二行你点折行后的字符看看程序能不能正确定位 ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    h(Text, { color: "dim" }, "── 嵌套 Box padding 测试 ──"),
    h(Box, { paddingLeft: 2 }, h(TrackedText, null, "缩进两格的文字")),
    h(Box, { marginTop: 1 },
      h(Text, { color: "green" }, lastClick),
      h(Text, { color: "yellow" }, ` | grid:${gridSize}`),
    ),
    h(Text, { color: "magenta" }, diag.slice(0, 80)),
  );
}

render(h(App, null), { exitOnCtrlC: false, patchConsole: false });
