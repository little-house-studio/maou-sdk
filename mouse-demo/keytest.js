/**
 * 测试 Cmd+C 在 Terminal.app raw mode 下发什么字节到程序。
 * 跑：node mouse-demo/keytest.js
 * 按各种键（Cmd+C, Ctrl+C, 普通 c），看输出的字节。
 * q 退出。
 */
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write("按键测试（q 退出）。按 Cmd+C / Ctrl+C / c，看字节：\n");
process.stdin.on("data", (buf) => {
  const s = buf.toString("latin1");
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    const hex = code.toString(16).padStart(2, "0");
    process.stdout.write(`字符:${JSON.stringify(ch)} code:${code} hex:0x${hex}  `);
  }
  process.stdout.write("\n");
  if (s.includes("q")) {
    process.stdin.setRawMode(false);
    process.exit(0);
  }
});
