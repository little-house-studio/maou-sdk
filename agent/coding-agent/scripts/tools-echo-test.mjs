/**
 * 验证三修复：动态注入回声(Fix2) + 工具参数容错(Fix3) + 流式未被 stall 包装破坏(Fix1)。
 * 6 轮工具密集对话（临时 scratch），统计回声出现次数 + 工具报错轮次。
 */
import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, runCodingAgentCli } from "../dist/index.js";

const HARD = setTimeout(() => { console.log("\n⏱ 硬超时强制退出"); process.exit(2); }, 200000);
const userMaou = join(process.env.HOME ?? "", ".maou");
const maouRoot = mkdtempSync(join(tmpdir(), "maou-te-root-"));
const projectRoot = mkdtempSync(join(tmpdir(), "maou-te-proj-"));
writeFileSync(join(projectRoot, "seed.txt"), "种子文件\n");

const cfg = new ConfigStore(projectRoot, userMaou);
const preset = cfg.get().api.presets[0];
const tools = new ToolRegistry(); registerBuiltins(tools);
const sessions = new SessionStore(join(projectRoot, ".maou", "sessions"));
const agent = createCodingAgent({ projectRoot, maouRoot, configStore: cfg, sessionStore: sessions, toolRegistry: tools, llmClient: new LLMClient() });
const sid = agent.startSession();
console.log(`▶ session=${sid} | scratch=${projectRoot}\n`);

const turns = [
  "用终端运行 ls 命令，列出当前目录的文件。",
  "创建文件 hello.js，写一个名为 greet 的函数，打印 'hi'。",
  "在 hello.js 里再加一个名为 bye 的函数打印 'bye'，保留 greet。",
  "用终端运行 cat hello.js 确认内容。",
  "读取 hello.js 并告诉我里面有几个函数。",
  "总结一下：这个会话里你一共帮我做了哪些操作？",
];

const ECHO_RE = /(收到状态信息|等待你的下一步指令|等待指令|没有正在运行的终端)/;
let echoCount = 0, errorRounds = 0, paramErrRounds = 0;
async function turn(text) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 60000);
  let ans = ""; const tc = []; let paramErr = false;
  try {
    await runCodingAgentCli(text, { agent, sessionId: sid, preset, signal: ac.signal,
      onEvent: (ev) => {
        if (ev.type === "assistant_delta" && ev.delta) ans += String(ev.delta);
        else if (ev.type === "tool_call") tc.push(ev.tool?.name);
        else if (ev.type === "tool_result" && typeof ev.content === "string" && /缺少|参数|format|required/.test(ev.content)) paramErr = true;
        else if (ev.type === "error") errorRounds++;
      } });
  } catch (e) { ans = "[err]" + (e?.message ?? e); }
  clearTimeout(tm);
  if (paramErr) paramErrRounds++;
  return { ans, tc };
}

for (let i = 0; i < turns.length; i++) {
  const { ans, tc } = await turn(turns[i]);
  const echo = ECHO_RE.test(ans);
  if (echo) echoCount++;
  console.log(`T${i+1} [${tc.join(",")||"-"}]${echo?" 🔁回声":""} → ${ans.replace(/\s+/g," ").slice(0,60)}`);
}

console.log(`\n=== 结果 ===`);
console.log(`🔁 动态注入回声出现: ${echoCount}/${turns.length} 轮 ${echoCount===0?"✅(Fix2 生效)":"⚠️"}`);
console.log(`🔧 工具参数报错轮次: ${paramErrRounds} ${paramErrRounds===0?"✅":"(模型偶发，已容错别名)"}`);
console.log(`❌ error 事件: ${errorRounds}`);

rmSync(maouRoot, { recursive: true, force: true });
rmSync(projectRoot, { recursive: true, force: true });
clearTimeout(HARD);
console.log("✅ 结束");
