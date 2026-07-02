// 测试 1：鼠标点击/拖选/OSC52 + 基础键盘
import { spawnCli } from "./pty-driver.mjs";

const log = (...a) => process.stderr.write(a.join(" ") + "\n");
const t = await spawnCli({ cols: 100, rows: 32 });
await t.wait(800);

log("=== 1.启动屏（末 250 字）===");
log(t.tail(250));

// 键盘输入
t.write("hello 你好");
await t.wait(300);
log("\n=== 2.输入 hello 你好 ===");
const inputLine = t.grep(/❯/).pop() || "";
log("输入框:", JSON.stringify(inputLine.trim()));
log("含 hello 你好:", inputLine.includes("hello 你好"));

// 鼠标点击输入框（鼠标默认关，Ink 不开 1002，SGR 应被 useCleanInput 吞，不进 textarea）
// 先清空
t.write("\x15"); // Ctrl+U
await t.wait(150);
t.write("abc");
await t.wait(150);
// 发 SGR 点击（模拟终端即使没开 1002 也可能发的序列）
t.mouseDown(8, 30);
await t.wait(100);
t.mouseUp(8, 30);
await t.wait(150);
const afterClick = (t.grep(/❯/).pop() || "").trim();
log("\n=== 3.发 SGR 点击后输入框（应仍 abc，无乱码）===");
log("输入框:", JSON.stringify(afterClick));
log("SGR 泄漏(含 [< 或 Mabc):", afterClick.includes("[<") || /M.*abc/.test(afterClick) || afterClick.includes("8;30"));

// 拖选
log("\n=== 4.拖选 col3→8 row30 ===");
await t.drag(3, 30, 8, 30);
await t.wait(200);
log("拖选后无崩溃，末尾:", t.tail(150));

// Ctrl+K 命令面板 + 鼠标点选项
log("\n=== 5.Ctrl+K + 鼠标点 overlay 选项 ===");
t.write("\x0b"); // Ctrl+K
await t.wait(400);
log("overlay 出现:", t.grep(/命令|▸ 新对话/).length > 0);
// overlay 在 top=3，选项行约 row 5-12。点"选择模型"（第3项约 row7）
await t.click(5, 7);
await t.wait(300);
log("点选项后:", t.tail(200).includes("模型") || t.tail(200).includes("coding"));

// resize 测试
log("\n=== 6.resize 80→120→40 ===");
t.resize(80, 24); await t.wait(200);
log("80x24 状态栏:", (t.grep(/think:|coding/).pop()||"").trim());
t.resize(120, 40); await t.wait(200);
log("120x40 状态栏:", (t.grep(/think:|coding/).pop()||"").trim());
t.resize(40, 20); await t.wait(200);
log("40x20 状态栏:", (t.grep(/think:|coding/).pop()||"").trim());

await t.quit();
log("\n=== 完成 ===");
process.exit(0);
