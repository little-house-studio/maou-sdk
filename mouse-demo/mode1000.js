/**
 * ?1000 模式测试 —— Claude Code 实际用的模式。
 *
 * 只开 ?1000?1006（按下/释放上报，不上报 motion）。
 * 测试：拖拽文字时，终端是否画原生蓝底选区？松手能否收到 release？
 *
 * 跑：node mouse-demo/mode1000.js
 * Ctrl+C 退出。
 */
const ESC = "\x1b";
const mouse1000On = `${ESC}[?1000h${ESC}[?1006h`;
const mouseOff = `${ESC}[?1006l${ESC}[?1000l`;

const TEXT_LINES = [
  "这是第一行对话内容 hello world 你好世界。",
  "第二行 The quick brown fox jumps over the lazy dog.",
  "第三行 拖拽选我试试 看是否蓝底原生选区。",
  "第四行 松手后按 Cmd+C 复制。",
];

let lastFeedback = "?1000 模式：拖拽文字看是否蓝底选区";

function render() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write(`${ESC}[1;1H?1000 模式 demo（Ctrl+C 退出）`);
  let row = 3;
  for (const line of TEXT_LINES) {
    process.stdout.write(`${ESC}[${row};1H${line}`);
    row++;
  }
  process.stdout.write(`${ESC}[${row + 1};1H${lastFeedback}`);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(`${ESC}[?1049h${ESC}[H${ESC}[2J${mouse1000On}`);
render();

let pending = "";
process.stdin.on("data", (chunk) => {
  let s = pending + chunk.toString("latin1");
  if (s.includes("\x03")) { cleanup(); process.exit(0); }
  const re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    const b = parseInt(m[1], 10);
    const c = parseInt(m[2], 10);
    const r = parseInt(m[3], 10);
    const type = m[4];
    const button = b & 3;
    const isMotion = !!(b & 32);
    if (type === "M" && button === 0 && !isMotion) {
      lastFeedback = `按下 ${c},${r}`;
      render();
    } else if (type === "m") {
      lastFeedback = `释放 ${c},${r}（收到 release！）`;
      render();
    } else if (isMotion) {
      lastFeedback = `motion ${c},${r}（?1000 居然报了 motion）`;
      render();
    }
    last = re.lastIndex;
  }
  pending = s.slice(last);
});

function cleanup() {
  process.stdout.write(mouseOff + `${ESC}[?1049l`);
  try { process.stdin.setRawMode(false); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", () => { try { cleanup(); } catch {} });
