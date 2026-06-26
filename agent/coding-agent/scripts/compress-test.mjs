/**
 * ContextEngine 压缩逻辑确定性验证（不依赖 LLM）。
 * 喂合成大历史 + 极小 maxTokens 强制触发压缩，断言：
 * 五阶段升级 / 按 task_id 任务块 / 落盘 / 可逆恢复 / token 真降 / 备份+zone。
 */
import { HarnessSessionStore, TaskSessionStore, ContextEngine, estimateTokens } from "@little-house-studio/context";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const maouRoot = mkdtempSync(join(tmpdir(), "maou-compress-"));
const agent = "coding";
const sid = "test-session-1";

const harnessStore = new HarnessSessionStore({ maouRoot });
const taskStore = new TaskSessionStore(maouRoot, agent);
const engine = new ContextEngine({ sessionId: sid, harnessStore, taskStore }); // 无 summarizer → 确定性 truncate

// 合成 8 个回合簇（task），每个 user+assistant+tool，长内容
const big = (label, n) => (label + " ").repeat(n);
const msgs = [];
for (let i = 0; i < 8; i++) {
  msgs.push({ role: "user", content: `任务${i}：请帮我处理模块 ${i} 的需求。${big("需求细节", 60)}` });
  msgs.push({ role: "assistant", content: `好的，我来处理模块 ${i}。${big("分析与实现步骤", 80)}` });
  msgs.push({ role: "tool", content: `工具输出 ${i}：${big("文件内容数据块", 100)}`, toolCallId: `tc-${i}` });
}

engine.initFromSessionMessages(msgs);
const before = estimateTokens(engine.getHistory());
const taskIds = [...new Set(engine.getHistory().flatMap(m => m.taskIds))];
console.log(`初始: ${engine.getHistory().length} 条消息 | ${before} token | task_ids: [${taskIds.join(",")}]`);

engine.save(); // 写 harness_session.json（供 backup 对照）

const report = await engine.compress(300); // 极小阈值，强制升级
const after = estimateTokens(engine.getHistory());
console.log(`压缩: stage=${report.stage} | token ${report.originalTokens}→${report.compressedTokens}(实测after=${after}) | 任务块[${report.taskBlocks.join(",")}] | 摘要${report.droppedSummary.length}字`);

const sessDir = join(maouRoot, "sessions", sid);
const firstTask = report.taskBlocks[0];
const taskFile = firstTask ? join(maouRoot, "agents", agent, "sessions", sid, "task_session", `${firstTask}.jsonl`) : "";
const restored = firstTask ? engine.restoreTask(firstTask) : null;

const checks = [
  ["task_id 正确分配(≥6簇)", taskIds.filter(t=>t).length >= 6],
  ["token 真降", after < before],
  ["阶段升级到 summary/archive", report.stage === "summaryStage" || report.stage === "archiveStage"],
  ["产出任务块", report.taskBlocks.length > 0],
  ["harness_session.json 落盘", existsSync(join(sessDir, "harness_session.json"))],
  ["harness_session_backup.json 落盘", existsSync(join(sessDir, "harness_session_backup.json"))],
  ["compressed_zone.json 落盘", existsSync(join(sessDir, "compressed_zone.json"))],
  ["任务块原文 jsonl 落盘", taskFile && existsSync(taskFile)],
  ["restoreTask 拿回原文", !!(restored && Array.isArray(restored.messages) && restored.messages.length > 0)],
];

console.log("\n=== 断言 ===");
let allPass = true;
for (const [name, ok] of checks) { console.log((ok ? "✅" : "❌") + " " + name); if (!ok) allPass = false; }
console.log(allPass ? "\n🎉 压缩逻辑全部通过" : "\n⚠️ 有断言失败");

rmSync(maouRoot, { recursive: true, force: true });
process.exit(allPass ? 0 : 1);
