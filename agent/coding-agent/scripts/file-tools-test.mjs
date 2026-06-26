/**
 * 验证 Fix2(动态注入回声) + Fix3(参数容错)，用纯文件工具多轮对话（不碰终端，绕开 terminal-engine 卡点）。
 */
import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, runCodingAgentCli } from "../dist/index.js";

setTimeout(() => { console.log("\n⏱ 硬退出"); process.exit(2); }, 120000);
const maouRoot = mkdtempSync(join(tmpdir(), "maou-ft-root-"));
const projectRoot = mkdtempSync(join(tmpdir(), "maou-ft-proj-"));
writeFileSync(join(projectRoot, "seed.txt"), "TODO: 修复\n第二行\n");
const cfg = new ConfigStore(projectRoot, join(process.env.HOME ?? "", ".maou"));
const preset = cfg.get().api.presets[0];
const tools = new ToolRegistry(); registerBuiltins(tools);
const sessions = new SessionStore(join(projectRoot, ".maou", "sessions"));
const agent = createCodingAgent({ projectRoot, maouRoot, configStore: cfg, sessionStore: sessions, toolRegistry: tools, llmClient: new LLMClient() });
const sid = agent.startSession();
console.log(`▶ session=${sid}\n`);

const turns = [
  "创建文件 hello.js，写一个名为 greet 的函数打印 'hi'。创建后确认一下。",
  "在 hello.js 里再加一个 bye 函数打印 'bye'，保留 greet。",
  "读取 hello.js，告诉我里面有哪几个函数。",
  "用 glob 找出当前目录所有 .js 和 .txt 文件。",
  "用 grep 在所有文件里搜 TODO。",
  "总结一下：这个会话你帮我做了哪些操作？",
];
const ECHO_RE = /(收到状态信息|等待你的下一步指令|等待指令|没有正在运行的终端)/;
let echoCount = 0, paramErrRounds = 0;
for (let i = 0; i < turns.length; i++) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 50000);
  let ans = ""; const tc = []; let pErr = false;
  try {
    await runCodingAgentCli(turns[i], { agent, sessionId: sid, preset, signal: ac.signal,
      onEvent: (ev) => {
        if (ev.type === "assistant_delta" && ev.delta) ans += String(ev.delta);
        else if (ev.type === "tool_call") tc.push(ev.tool?.name);
        else if (ev.type === "tool_result" && typeof ev.content === "string" && /缺少.*参数|参数格式|required/.test(ev.content)) pErr = true;
      } });
  } catch (e) { ans = "[err]" + (e?.message ?? e); }
  clearTimeout(tm);
  const echo = ECHO_RE.test(ans); if (echo) echoCount++; if (pErr) paramErrRounds++;
  console.log(`T${i+1} [${tc.join(",")||"-"}]${echo?" 🔁回声":""}${pErr?" ⚠参数错":""} → ${ans.replace(/\s+/g," ").slice(0,55)}`);
}
console.log(`\n=== 结果 ===`);
console.log(`🔁 动态注入回声: ${echoCount}/${turns.length} ${echoCount===0?"✅ Fix2 生效":"⚠️ 仍有回声"}`);
console.log(`⚠ 工具参数报错轮次: ${paramErrRounds} ${paramErrRounds===0?"✅":"(偶发)"}`);
rmSync(maouRoot, { recursive: true, force: true });
rmSync(projectRoot, { recursive: true, force: true });
console.log("✅ 结束"); process.exit(0);
