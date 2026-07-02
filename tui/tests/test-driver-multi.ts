/**
 * 复现 TUI 多轮问题 —— 用真实 AgentDriver + reducer（模拟 app 的 send 路径）。
 * 连续发 3 条（不等前一条 UI 可交互，但 await 每条完成），
 * 重点看每条发送前 streaming 状态。
 */
import { createAppWithConfig } from "../src/app.js";
import { AgentDriver, loadAgentConfig } from "../src/agent.js";
import { initialState } from "../src/state/types.js";
import { ProcessTerminal, TUI } from "@oh-my-pi/pi-tui";

const config = await loadAgentConfig("/Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/src/cli-config.ts");

// 不真正启动 TUI（会进备用屏），只构造 driver 测状态机
const state = initialState();
const driver = new AgentDriver(config, {
  tui: { requestRender() {}, terminal: { rows: 24 } } as unknown as TUI,
  getState: () => state,
  setState: (updater) => { Object.assign(state, updater(state)); },
});

driver.initProviderModel();
process.stderr.write(`初始: streaming=${state.streaming} sessionId=${state.sessionId}\n`);

const msgs = ["只回复：第一句", "只回复：第二句", "只回复：第三句"];
for (let i = 0; i < msgs.length; i++) {
  process.stderr.write(`\n--- 发送第 ${i + 1} 条: "${msgs[i]}" ---\n`);
  process.stderr.write(`  发送前 streaming=${state.streaming}\n`);
  await driver.send(msgs[i]!);
  process.stderr.write(`  发送后 streaming=${state.streaming} messages数=${state.messages.length}\n`);
}
process.exit(0);
