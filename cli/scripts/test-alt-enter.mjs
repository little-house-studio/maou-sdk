// 复现 Alt+Enter bug
import { spawnCli } from "./pty-xterm-driver.mjs";
const w = (s) => process.stderr.write(String(s) + "\n");
const t = await spawnCli({ cols: 80, rows: 24 });
await t.wait(1500);
await t.type("hi");
await t.wait(200);
// Alt+Enter = \x1b\r
t.write("\x1b\r");
await t.wait(400);
await t.type("world");
await t.wait(300);

w("=== Alt+Enter 后屏幕(输入框区域) ===");
const lines = t.text().split("\n");
const idx = lines.findIndex(l => l.includes("❯"));
w("❯ 在 row " + idx);
lines.slice(Math.max(0, idx - 2), idx + 5).forEach((l, i) => w("  " + JSON.stringify(l)));
w("");
w("hi 和 world 在同一行(没换行): " + lines.some(l => l.includes("hi") && l.includes("world")));
// 硬件光标 + textarea 假光标
const allText = t.text();
const cursorChars = allText.match(/[▋█_]/g) || [];
w("屏上光标符号数(▋█_): " + cursorChars.length);

// 看原始 ANSI 找硬件光标定位序列（\x1b[row;colH）
const raw = t.raw();
const cursorMoves = raw.match(/\x1b\[\d+;\d+H/g) || [];
w("ANSI 光标移动序列数: " + cursorMoves.length);
w("最后几个光标位置: " + cursorMoves.slice(-3).join(" "));

await t.quit();
process.exit(0);
