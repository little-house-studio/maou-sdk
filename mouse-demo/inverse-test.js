/**
 * 反色/背景色测试 —— Terminal.app 备用屏里哪种反色能显示。
 * 跑：node mouse-demo/inverse-test.js
 * 按 q 退出。
 */
const ESC = "\x1b";
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(`${ESC}[?1049h${ESC}[2J${ESC}[H`);
process.stdout.write(`${ESC}[1;1H反色测试（按 q 退出）\n\n`);
process.stdout.write(`1. SGR 7m (inverse): ${ESC}[7m这段反色${ESC}[0m 正常\n`);
process.stdout.write(`2. 白背景 47m: ${ESC}[47m这段白底${ESC}[0m 正常\n`);
process.stdout.write(`3. 黑字白底 30;47m: ${ESC}[30;47m这段黑字白底${ESC}[0m 正常\n`);
process.stdout.write(`4. 亮色背景 48;5;245m: ${ESC}[38;5;0;48;5;245m这段灰底黑字${ESC}[0m 正常\n`);
process.stdout.write(`5. 反色+粗体 1;7m: ${ESC}[1;7m这段反色粗体${ESC}[0m 正常\n`);
process.stdin.on("data", (d) => {
  if (d.toString().includes("q") || d.toString().includes("\x03")) {
    process.stdout.write(`${ESC}[?1049l`);
    try { process.stdin.setRawMode(false); } catch {}
    process.exit(0);
  }
});
