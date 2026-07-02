import { runAgentCli } from "@little-house-studio/agent";
import type { AgentCliConfig } from "@little-house-studio/agent";
import { homedir } from "node:os";

const cfg = (await import("@little-house-studio/coding-agent/cli-config")).default as AgentCliConfig;
const handle = cfg.createAgent(process.cwd(), homedir() + "/.maou");
const preset = cfg.getPreset("xfyun-qwen-coding", "xopqwen36v35b");
process.stderr.write("[test-llm] preset.model=" + preset.model + " key=" + (preset.key ? "有" : "无") + "\n");
let n = 0;
await runAgentCli("只回复收到", {
  runtime: handle.runtime, sessionId: handle.startSession(), preset,
  onEvent: (ev) => { n++; process.stderr.write("[ev] " + ev.type + "\n"); },
  source: "tui",
});
process.stderr.write("[test-llm] done, 事件数=" + n + "\n");
process.exit(0);
