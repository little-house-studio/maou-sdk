// 测试：xterm-bridge 基础 + 鼠标 + resize
import { spawnCli } from "./xterm-bridge.mjs";

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const t = await spawnCli({ cols: 100, rows: 32 });
await t.wait(800);

log("=== 1.启动屏 ===");
log("屏行数:", t.screen().length);
const statusLine = t.grep(/coding|think/)[0] || "";
log("状态栏:", JSON.stringify(statusLine));
log("有 MAOU:", t.grep(/MAOU/).length > 0);

// 键盘输入
t.write("hello 你好");
await t.wait(300);
const inputLine = t.grep(/❯/).pop() || "";
log("\n=== 2.输入 hello 你好 ===");
log("输入框:", JSON.stringify(inputLine));
log("含 hello 你好:", inputLine.includes("hello 你好"));

// Ctrl+U 清空 + 鼠标 SGR 测试
t.write("\x15");
await t.wait(150);
t.write("abc");
await t.wait(200);
log("\n=== 3.输入 abc 后发 SGR 点击 ===");
t.mouseDown(8, 30);
await t.wait(100);
t.mouseUp(8, 30);
await t.wait(200);
const afterSgr = t.grep(/❯/).pop() || "";
log("输入框:", JSON.stringify(afterSgr));
log("SGR 泄漏(含 [< 或 8;30):", afterSgr.includes("[<") || afterSgr.includes("8;30"));

// Ctrl+K overlay + 鼠标点选项
log("\n=== 4.Ctrl+K 命令面板 ===");
t.write("\x0b");
await t.wait(400);
const overlayLines = t.grep(/命令|新对话|选择模型/);
log("overlay 行数:", overlayLines.length);
overlayLines.slice(0, 4).forEach(l => log("  ", l));

// 鼠标点 overlay 第二项（"选择模型"，约 row 6-7）
log("\n=== 5.鼠标点 overlay 选项 ===");
await t.click(5, 7);
await t.wait(300);
log("点后状态栏/屏:", t.grep(/coding|模型/).slice(-2));

// resize
log("\n=== 6.resize 80x24 ===");
t.resize(80, 24);
await t.wait(300);
log("80x24 屏:", t.screen().length, "行");
log("状态栏:", JSON.stringify(t.grep(/think:|coding/).pop() || ""));

await t.quit();
log("\n=== 完成 ===");
process.exit(0);
