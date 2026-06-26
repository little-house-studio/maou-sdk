/**
 * 定位终端轮 round 2 卡点。agent_round 事件在压缩之后、LLM 之前 yield，
 * 用它判断卡在压缩前(ContextEngine)还是 LLM。compression 由 argv 控制。
 */
import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins, initTerminalEngine } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, runCodingAgentCli } from "../dist/index.js";

const enableCompression = process.argv[2] !== "off";
const t0 = Date.now();
const log = (m) => console.log(`[+${((Date.now()-t0)/1000).toFixed(1)}s] ${m}`);
setTimeout(() => { log("⏱ 硬退出 70s"); process.exit(2); }, 70000);

const maouRoot = mkdtempSync(join(tmpdir(), "maou-diag-root-"));
const projectRoot = mkdtempSync(join(tmpdir(), "maou-diag-proj-"));
writeFileSync(join(projectRoot, "a.txt"), "x\n");
const cfg = new ConfigStore(projectRoot, join(process.env.HOME ?? "", ".maou"));
const preset = cfg.get().api.presets[0];
const tools = new ToolRegistry(); registerBuiltins(tools);
initTerminalEngine(join(maouRoot, "terminal-logs"), join(projectRoot, ".maou", "terminals.json"));
const sessions = new SessionStore(join(projectRoot, ".maou", "sessions"));
const agent = createCodingAgent({ projectRoot, maouRoot, configStore: cfg, sessionStore: sessions, toolRegistry: tools, llmClient: new LLMClient(), enableCompression });
const sid = agent.startSession();
log(`compression=${enableCompression} session=${sid}`);

const ac = new AbortController();
await runCodingAgentCli("用终端运行 ls 命令，列出当前目录文件。", {
  agent, sessionId: sid, preset, signal: ac.signal,
  onEvent: (ev) => {
    if (ev.type === "agent_round") log(`↻ agent_round=${ev.round}`);
    else if (ev.type === "tool_call") log(`🔧 tool_call=${ev.tool?.name} ${JSON.stringify(ev.tool?.parameters??{})}`);
    else if (ev.type === "tool_result") log(`✅ tool_result ${String(ev.content??"").replace(/\s+/g," ").slice(0,50)}`);
    else if (ev.type === "status") log(`… status: ${ev.text}`);
    else if (ev.type === "error") log(`❌ error: ${ev.message}`);
    else if (ev.type === "done") log(`🏁 done rounds=${ev.rounds}`);
  },
});
log("runCodingAgentCli 返回");
rmSync(maouRoot, { recursive: true, force: true });
rmSync(projectRoot, { recursive: true, force: true });
process.exit(0);
