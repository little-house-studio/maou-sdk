import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins, initTerminalEngine } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodingAgent, runCodingAgentCli } from "../dist/index.js";
setTimeout(()=>{console.log("⏱ 硬退出");process.exit(2)},90000);
const maouRoot = mkdtempSync(join(tmpdir(),"maou-cc-root-"));
const projectRoot = mkdtempSync(join(tmpdir(),"maou-cc-proj-"));
const cfg = new ConfigStore(projectRoot, join(process.env.HOME??"",".maou"));
const preset = cfg.get().api.presets[0];
const tools = new ToolRegistry(); registerBuiltins(tools);
initTerminalEngine(undefined, join(projectRoot,".maou","terminals.json"));
const sessions = new SessionStore(join(projectRoot,".maou","sessions"));
const agent = createCodingAgent({projectRoot,maouRoot,configStore:cfg,sessionStore:sessions,toolRegistry:tools,llmClient:new LLMClient()});
let termResult = "";
await runCodingAgentCli("用终端执行命令 `seq 1 200`，然后只告诉我最后一个数字是几。", {
  agent, preset,
  onEvent: (ev) => { if (ev.type==="tool_result" && typeof ev.content==="string" && ev.content.includes("\n")) termResult = ev.content; }
});
const lineCount = termResult.split("\n").length;
console.log(`\n终端 tool_result 行数: ${lineCount} ${lineCount<60?"✅ 已压缩(200行→"+lineCount+")":"⚠ 未压缩"}`);
console.log("包含省略标记:", termResult.includes("省略")?"✅":"(短输出无需)");
console.log("末尾片段:", JSON.stringify(termResult.split("\n").slice(-4).join(" / ")));
rmSync(maouRoot,{recursive:true,force:true}); rmSync(projectRoot,{recursive:true,force:true});
process.exit(0);
