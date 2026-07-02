// 真实交互式对话测试：Enter 发送真实消息，看流式渲染全链路。
import { spawnCli } from "./pty-xterm-driver.mjs";

const w = (s) => process.stderr.write(String(s) + "\n");
const t = await spawnCli({ cols: 100, rows: 32 });
await t.wait(1500);

w("=== 1.启动屏 ===");
w("有 MAOU: " + t.text().includes("MAOU"));
w("有输入框: " + t.text().includes("❯"));
w("状态栏: " + JSON.stringify((t.grep(/coding/)[0] || "").trim().slice(0, 85)));

// Enter 发送真实消息（逐字符 type，避免 Ink 把多字符 chunk 当 paste）
w("\n=== 2.Enter 发送「读 README.md 一句话总结」===");
await t.type("读 README.md 一句话总结这个项目是干嘛的");
t.write("\r"); // Enter 单独 write

// 等流式完成（最多 40s）
let waited = 0;
let sawThinking = false, sawTool = false, sawDone = false;
while (waited < 40000) {
  await t.wait(500); waited += 500;
  const s = t.text();
  if (!sawThinking && (s.includes("thinking") || s.includes("思考"))) sawThinking = true;
  if (!sawTool && (s.includes("reader") || s.includes("▌01"))) sawTool = true;
  if (s.includes("ch.01")) { sawDone = true; break; }
}
const s = t.text();
const lines = s.split("\n");
w("等待: " + waited + "ms");
w("有 user 消息: " + lines.some(l => l.includes("读 README")));
w("有 assistant 内容: " + lines.some(l => l.includes("Whisper") || lines.some(l => l.includes("语音") || l.includes("转文本"))));
w("有思考块: " + sawThinking);
w("有工具卡片(▌01/reader): " + sawTool);
w("done(ch.01): " + sawDone);
const status = lines.find(l => /coding/.test(l)) || "";
w("状态栏: " + JSON.stringify(status.trim().slice(0, 95)));
w("有 token 统计: " + /k\//.test(status));
w("有 sparkline: " + /[▁▂▃▄▅▆▇█]/.test(status));

// 第二轮对话
w("\n=== 3.第二轮对话 ===");
await t.type("再用英文说一遍");
t.write("\r");
waited = 0;
while (waited < 30000) { await t.wait(500); waited += 500; if (t.text().includes("ch.02")) break; }
w("第二轮 done(ch.02): " + t.text().includes("ch.02"));
w("sparkline 有2点: " + (t.text().match(/[▁▂▃▄▅▆▇█·]/g)?.length || 0) > 5);

await t.quit();
w("\n=== 完成 ===");
process.exit(0);
