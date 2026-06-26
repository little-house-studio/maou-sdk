/**
 * 聚焦实测：ContextEngine 在真实 coding-agent 运行中的压缩 + 压缩后记忆保留。
 * 纯长文本对话快速堆 token，maxContext=1500 触发压缩；无终端/文件操作（避开噪声与挂起面）。
 * 末轮回溯前文，验证压缩后历史记忆是否保留。
 */
import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, runCodingAgentCli } from "../dist/index.js";

const userMaou = join(process.env.HOME ?? "", ".maou");
const maouRoot = mkdtempSync(join(tmpdir(), "maou-cl-root-"));
const projectRoot = mkdtempSync(join(tmpdir(), "maou-cl-proj-"));

// 全局硬超时：LLM 卡死是异步 IO（不阻塞事件循环），setTimeout 仍会触发 → 强制退出。
const HARD = setTimeout(() => { console.log("\n⏱ 全局硬超时(220s)，强制退出"); process.exit(2); }, 220000);

const cfg = new ConfigStore(projectRoot, userMaou);
const preset = { ...cfg.get().api.presets[0], maxContext: 1500 };
const tools = new ToolRegistry(); registerBuiltins(tools);
const sessions = new SessionStore(join(projectRoot, ".maou", "sessions"));
const agent = createCodingAgent({ projectRoot, maouRoot, configStore: cfg, sessionStore: sessions, toolRegistry: tools, llmClient: new LLMClient() });
const sid = agent.startSession();
console.log(`▶ session=${sid} | maxContext=${preset.maxContext} | 压缩=on\n`);

const DOC = (t) => `请阅读下面关于「${t}」的文档并用一句话概括核心（直接回答，不要调用工具）：\n` +
  `${t}是后端工程的重要主题，涉及大量实现细节、边界条件、性能权衡与历史背景。`.repeat(14);
const topics = ["缓存策略", "消息队列", "数据库索引", "分布式锁", "限流算法", "可观测性"];

const sessDir = join(maouRoot, "sessions", sid);
let firstCompressTurn = -1;
async function turn(text, label) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 45000);
  let ans = ""; const tc = [];
  try {
    await runCodingAgentCli(text, { agent, sessionId: sid, preset, signal: ac.signal,
      onEvent: (ev) => { if (ev.type === "assistant_delta" && ev.delta) ans += String(ev.delta); else if (ev.type === "tool_call") tc.push(ev.tool?.name); } });
  } catch (e) { ans = "[abort/err] " + (e?.message ?? e); }
  clearTimeout(tm);
  return { ans, tc };
}

for (let i = 0; i < topics.length; i++) {
  const { ans, tc } = await turn(DOC(topics[i]), `T${i+1}`);
  const zone = existsSync(join(sessDir, "compressed_zone.json"));
  if (zone && firstCompressTurn < 0) firstCompressTurn = i + 1;
  console.log(`T${i+1} [${tc.join(",") || "-"}] 压缩区=${zone ? "✅" : "⬜"} → ${ans.replace(/\s+/g, " ").slice(0, 50)}`);
}

const { ans: recap } = await turn("回顾一下：我前面一共发给你几段文档？分别是关于什么主题的？按顺序列出。", "recap");
console.log(`\n=== 压缩后记忆回溯 ===\n${recap.replace(/\s+/g, " ").slice(0, 350)}`);
// 检查回溯是否提到了早期主题（验证压缩没丢失早期记忆）
const hitTopics = topics.filter(t => recap.includes(t));
console.log(`\n回溯命中主题: ${hitTopics.length}/${topics.length} [${hitTopics.join(",")}]`);

console.log("\n=== 压缩落盘产物 ===");
for (const f of ["harness_session.json", "harness_session_backup.json", "compressed_zone.json"])
  console.log((existsSync(join(sessDir, f)) ? "✅" : "⬜") + " " + f);
const tdir = join(maouRoot, "agents", agent.agentName, "sessions", sid, "task_session");
const tb = existsSync(tdir) ? readdirSync(tdir).filter(f => f.endsWith(".jsonl")) : [];
console.log(`任务块原文: ${tb.length} 个`);
if (existsSync(join(sessDir, "compressed_zone.json")))
  console.log("compressed_zone:", readFileSync(join(sessDir, "compressed_zone.json"), "utf-8").replace(/\s+/g, " ").slice(0, 250));
console.log(`\n首次压缩出现: ${firstCompressTurn > 0 ? "T" + firstCompressTurn : "未触发"}`);

rmSync(maouRoot, { recursive: true, force: true });
rmSync(projectRoot, { recursive: true, force: true });
clearTimeout(HARD);
console.log("✅ 结束");
