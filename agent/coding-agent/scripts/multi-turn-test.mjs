/**
 * coding-agent 多轮全工具 + 长文本 + 真实压缩集成测试。
 * - 临时 scratch 项目目录（write/edit/terminal 隔离，安全）
 * - 单会话累积 15 轮，覆盖 glob/grep/reader/write_file/edit_file/use_terminal/find_code
 * - preset.maxContext 调小到 2500 → 历史超阈值触发真实 ContextEngine 压缩
 * - 逐轮记录工具调用/错误/答案；结束后查压缩落盘产物 + 历史记忆是否保留
 */
import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, runCodingAgentCli } from "../dist/index.js";

const HOME = process.env.HOME ?? "";
const userMaou = join(HOME, ".maou");
// 独立 maouRoot（隔离 agent 定义 + 压缩落盘，不污染真实 ~/.maou）
const maouRoot = mkdtempSync(join(tmpdir(), "maou-itest-root-"));
// scratch 项目目录
const projectRoot = mkdtempSync(join(tmpdir(), "maou-itest-proj-"));
writeFileSync(join(projectRoot, "notes.txt"), "第一行\nTODO: 修复登录 bug\n第三行\nTODO: 补充测试\n第五行\n");
writeFileSync(join(projectRoot, "data.txt"), Array.from({length: 20}, (_,i)=>`数据行 ${i+1}`).join("\n") + "\n");
writeFileSync(join(projectRoot, "sample.js"), "function existing() { return 1; }\n");

// 配置：读真实 preset，克隆并把 maxContext 调小以触发压缩
const cfgStore = new ConfigStore(projectRoot, userMaou);
const realPreset = cfgStore.get().api?.presets?.[0];
if (!realPreset) { console.error("❌ 无 preset"); process.exit(1); }
const preset = { ...realPreset, maxContext: 2500 };
console.log(`▶ 模型 ${preset.model} | maxContext 调小为 ${preset.maxContext}（触发压缩） | scratch=${projectRoot}`);

const toolRegistry = new ToolRegistry();
registerBuiltins(toolRegistry);
const sessionStore = new SessionStore(join(projectRoot, ".maou", "sessions"));
const llmClient = new LLMClient();

const agent = createCodingAgent({ projectRoot, maouRoot, configStore: cfgStore, sessionStore, toolRegistry, llmClient });
const sessionId = agent.startSession("itest");
console.log(`▶ agent=${agent.agentName} | session=${sessionId} | 压缩=on\n`);

const LONG = "这是一段用于撑大上下文窗口的长需求描述文本，包含若干重复的业务细节与边界条件说明。".repeat(12);
const turns = [
  "用 glob 找出当前项目目录下所有 .txt 文件，列出文件名。",
  "读取 notes.txt 的完整内容。",
  "用 grep 搜索当前目录所有文件里包含 TODO 的行。",
  "创建文件 hello.js，写一个名为 greet 的函数，打印 'hello from coding agent'。",
  "在 hello.js 里再加一个名为 farewell 的函数打印 'bye'，保留原有 greet。",
  "用终端运行 ls 命令，告诉我当前目录有哪些文件。",
  `下面是一段需求文档，请用三句话概括核心内容：\n${LONG}`,
  "用 grep 找出 hello.js 里定义了哪些函数。",
  `再看这段补充材料，和上一段比有无区别：\n${LONG}`,
  "读取 data.txt，统计它有多少行。",
  "在 notes.txt 末尾追加一行 'reviewed'（可用 edit_file）。",
  "用终端运行 cat notes.txt 确认追加成功。",
  `这是第三段长材料，请概括：\n${LONG}`,
  "从这个会话开始到现在，你一共帮我做了哪些操作？尽量具体列出。",
  "我们一共创建和修改了哪几个文件？",
];

let compressionEvents = 0;
const errors = [];
for (let i = 0; i < turns.length; i++) {
  const toolCalls = [];
  let answer = "";
  let errored = false;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120000);
  try {
    await runCodingAgentCli(turns[i], {
      agent, sessionId, preset, signal: ac.signal,
      onEvent: (ev) => {
        if (ev.type === "assistant_delta" && ev.delta) answer += String(ev.delta);
        else if (ev.type === "tool_call") toolCalls.push(ev.tool?.name);
        else if (ev.type === "error") { errored = true; errors.push(`turn${i+1}: ${ev.message}`); }
        else if (ev.type === "log" && typeof ev.message === "string" && ev.message.includes("已压缩")) {
          compressionEvents++;
          if (ev.message.includes("engine")) process.stdout.write(`\n   🗜 ${ev.message.trim()}`);
        }
      },
    });
  } catch (e) { errored = true; errors.push(`turn${i+1} 异常: ${e?.message}`); }
  clearTimeout(timer);
  const snippet = answer.replace(/\s+/g, " ").slice(0, 70);
  console.log(`T${String(i+1).padStart(2)} [${toolCalls.join(",")||"无工具"}]${errored?" ❌":""} → ${snippet}`);
}

// ── 压缩落盘产物检查 ──
console.log("\n=== 压缩落盘产物 ===");
const sessDir = join(maouRoot, "sessions", sessionId);
const taskSessDir = join(maouRoot, "agents", agent.agentName, "sessions", sessionId, "task_session");
const artifacts = {
  "harness_session.json": join(sessDir, "harness_session.json"),
  "harness_session_backup.json": join(sessDir, "harness_session_backup.json"),
  "compressed_zone.json": join(sessDir, "compressed_zone.json"),
};
for (const [k, p] of Object.entries(artifacts)) console.log((existsSync(p)?"✅":"⬜")+" "+k);
const taskBlocks = existsSync(taskSessDir) ? readdirSync(taskSessDir).filter(f=>f.endsWith(".jsonl")) : [];
console.log(`${taskBlocks.length>0?"✅":"⬜"} 任务块原文 jsonl: ${taskBlocks.length} 个 [${taskBlocks.join(",")}]`);

// ── 实际写出的文件检查（工具真生效）──
console.log("\n=== 工具产物（scratch 目录）===");
for (const f of ["hello.js", "notes.txt"]) {
  const p = join(projectRoot, f);
  console.log((existsSync(p)?"✅":"❌")+" "+f+(existsSync(p)?` (${readFileSync(p,"utf-8").length}字节)`:""));
}

console.log(`\n=== 总结 ===`);
console.log(`压缩触发次数(engine 日志): ${compressionEvents}`);
console.log(`错误数: ${errors.length}`);
if (errors.length) errors.forEach(e=>console.log("  ⚠ "+e));

rmSync(maouRoot, { recursive: true, force: true });
rmSync(projectRoot, { recursive: true, force: true });
console.log("\n✅ 集成测试结束");
