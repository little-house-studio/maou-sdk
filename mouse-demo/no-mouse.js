/**
 * 无鼠标模式测试 —— 完全不开 ?1000，看终端是否画原生蓝底选区。
 *
 * 这是 Claude Code Classic 模式（altScreenMouseTracking="off"）的模拟。
 * 不发任何鼠标序列，终端原生选区应可用。
 *
 * 跑：node mouse-demo/no-mouse.js
 * Ctrl+C 退出。
 */
const ESC = "\x1b";
const TEXT_LINES = [
  "这是第一行对话内容 hello world 你好世界。",
  "第二行 The quick brown fox jumps over the lazy dog.",
  "第三行 拖拽选我试试 看是否蓝底原生选区。",
  "第四行 松手后按 Cmd+C 复制。",
];

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(`${ESC}[?1049h${ESC}[H${ESC}[2J`);
process.stdout.write(`${ESC}[1;1H无鼠标模式 demo（Ctrl+C 退出，不开任何鼠标协议）`);
let row = 3;
for (const line of TEXT_LINES) {
  process.stdout.write(`${ESC}[${row};1H${line}`);
  row++;
}
process.stdout.write(`${ESC}[${row + 1};1H拖拽文字 → 应出现终端原生蓝底选区 → 松手 Cmd+C 复制`);

process.stdin.on("data", (d) => {
  if (d.toString().includes("\x03")) {
    process.stdout.write(`${ESC}[?1049l`);
    try { process.stdin.setRawMode(false); } catch {}
    process.exit(0);
  }
});
