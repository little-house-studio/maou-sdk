/**
 * 多轮对话测试 —— 复现 "最多连续两轮" 问题。
 * 发送 3 条消息，检查每轮 done 事件和 streaming 状态。
 */
import { runAgentCli } from "@little-house-studio/agent";
import type { AgentCliConfig } from "@little-house-studio/agent";
import { homedir } from "node:os";

const cfg = (await import("/Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/src/cli-config.ts")).default as AgentCliConfig;
const handle = cfg.createAgent(process.cwd(), homedir() + "/.maou");
const preset = cfg.getPreset("xfyun-qwen-coding", "xopqwen36v35b");
const sessionId = handle.startSession();

const messages = ["只回复：第一句收到", "只回复：第二句收到", "只回复：第三句收到"];

for (let i = 0; i < messages.length; i++) {
  process.stderr.write(`\n========== 第 ${i + 1} 轮 ==========\n`);
  let eventCount = 0;
  let lastType = "";
  try {
    await runAgentCli(messages[i]!, {
      runtime: handle.runtime,
      sessionId,
      preset,
      onEvent: (ev) => {
        eventCount++;
        lastType = ev.type;
        if (ev.type === "done" || ev.type === "error" || ev.type === "agent_round" || ev.type === "session") {
          process.stderr.write(`  [ev] ${ev.type}${ev.type === "error" ? ": " + (ev as { message?: string }).message : ""}\n`);
        }
      },
      source: "tui",
    });
    process.stderr.write(`第 ${i + 1} 轮完成: 事件数=${eventCount} 最后事件=${lastType}\n`);
  } catch (e) {
    process.stderr.write(`第 ${i + 1} 轮异常: ${e instanceof Error ? e.message : e}\n`);
  }
}
process.exit(0);
