/**
 * OSC52 测试 demo —— Terminal.app 是否支持 OSC52 剪贴板写入。
 *
 * 跑：node mouse-demo/osc52-test.js
 *
 * 流程：
 * 1. 进备用屏，显示提示
 * 2. 按 1 → 发 OSC52 写 "Hello from OSC52" 到剪贴板
 * 3. 你按 Cmd+V 粘贴，看是否是 "Hello from OSC52"
 * 4. 按 2 → 发更长的中文测试
 * 5. 按 q 退出
 *
 * 如果 Cmd+V 能粘贴出内容 → OSC52 可用 → "自画选区 + OSC52" 方案可行
 * 如果粘贴不出 → OSC52 被禁 → 需走别的路
 */
const ESC = "\x1b";
const enterAlt = `${ESC}[?1049h`;
const exitAlt = `${ESC}[?1049l`;
const hideCursor = `${ESC}[?25l`;
const showCursor = `${ESC}[?25h`;

function osc52(text) {
  // OSC52: ESC ] 52 ; c ; <base64> BEL
  const b64 = Buffer.from(text, "utf-8").toString("base64");
  return `${ESC}]52;c;${b64}\x07`;
}

function draw() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
  process.stdout.write("OSC52 测试（Terminal.app 剪贴板）\r\n");
  process.stdout.write("────────────────────────────────\r\n");
  process.stdout.write("按 1 → 写 \"Hello from OSC52\" 到剪贴板\r\n");
  process.stdout.write("按 2 → 写 \"你好 OSC52 测试 123\" 到剪贴板\r\n");
  process.stdout.write("按 q → 退出\r\n");
  process.stdout.write("────────────────────────────────\r\n");
  process.stdout.write("操作后切到别处按 Cmd+V 粘贴，看能否粘出内容。\r\n");
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write(enterAlt + hideCursor);
draw();

process.stdin.on("data", (chunk) => {
  const s = chunk.toString("latin1");
  if (s.includes("1")) {
    process.stdout.write(`${ESC}[10;1H${ESC}[2K已发 OSC52: "Hello from OSC52" → 去 Cmd+V 粘贴`);
    process.stdout.write(osc52("Hello from OSC52"));
  } else if (s.includes("2")) {
    process.stdout.write(`${ESC}[10;1H${ESC}[2K已发 OSC52: "你好 OSC52 测试 123" → 去 Cmd+V 粘贴`);
    process.stdout.write(osc52("你好 OSC52 测试 123"));
  } else if (s.includes("q") || s.includes("\x03")) {
    process.stdout.write(showCursor + exitAlt);
    try { process.stdin.setRawMode(false); } catch {}
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  process.stdout.write(showCursor + exitAlt);
  try { process.stdin.setRawMode(false); } catch {}
  process.exit(0);
});
