/**
 * PTY 驱动 TUI 多轮测试 v2 —— 可靠检测。
 *
 * 策略：启动 TUI 后，每条消息发送后等固定时长，检查 assistant 回复出现。
 * 用 MAOU_DEBUG=1 让 driver 输出 [send] 日志到 stderr（pty 合并）。
 */
import { spawn } from "@lydell/node-pty";

const TUI_DIR = "/Users/mac/Documents/vscodeProject/maou-sdk/tui";
const AGENT_PATH = "/Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/src/cli-config.ts";

const pty = spawn(process.execPath, ["--import", `${TUI_DIR}/preload.mjs`, `${TUI_DIR}/src/maou-entry.ts`, AGENT_PATH], {
  name: "xterm-256color",
  cols: 100,
  rows: 30,
  cwd: "/Users/mac/Downloads/coding测试",
  env: { ...process.env, MAOU_DEBUG: "1" },
});

let buffer = "";
const rounds = ["只回复收到1", "只回复收到2", "只回复收到3", "只回复收到4", "只回复收到5"];
let roundIdx = 0;

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07?|\x1b[=>78NX_Z^_()*+]/g, "");

pty.onData((data) => {
  buffer += data;
});

function sendAndWait(msg: string, waitMs: number): Promise<{ entered: boolean; resolved: boolean; skipped: boolean }> {
  return new Promise((resolve) => {
    const beforeEnter = (stripAnsi(buffer).match(/\[send\] enter/g) || []).length;
    const beforeResolved = (stripAnsi(buffer).match(/runAgentCli resolved/g) || []).length;
    const beforeSkip = (stripAnsi(buffer).match(/\[send\] SKIP/g) || []).length;
    pty.write(msg + "\r");
    setTimeout(() => {
      const after = stripAnsi(buffer);
      const enterCount = (after.match(/\[send\] enter/g) || []).length;
      const resolvedCount = (after.match(/runAgentCli resolved/g) || []).length;
      const skipCount = (after.match(/\[send\] SKIP/g) || []).length;
      resolve({
        entered: enterCount > beforeEnter,
        resolved: resolvedCount > beforeResolved,
        skipped: skipCount > beforeSkip,
      });
    }, waitMs);
  });
}

async function main() {
  // 等 TUI 启动
  await new Promise(r => setTimeout(r, 3000));
  process.stderr.write("[pty] TUI 启动，开始发消息\n");

  for (let i = 0; i < rounds.length; i++) {
    process.stderr.write(`\n===== 第 ${i + 1} 轮: "${rounds[i]}" =====\n`);
    const r = await sendAndWait(rounds[i]!, 25000);
    process.stderr.write(`  entered=${r.entered} resolved=${r.resolved} skipped=${r.skipped}\n`);
    if (!r.entered) {
      process.stderr.write(`  ❌ 第 ${i + 1} 条未进入 send！onSubmit 没触发。\n`);
    } else if (r.skipped) {
      process.stderr.write(`  ⚠️ 第 ${i + 1} 条进入 send 但被 SKIP（streaming 守卫拦截）\n`);
    } else if (!r.resolved) {
      process.stderr.write(`  ⚠️ 第 ${i + 1} 条进入 send 但未 resolved（卡住/超时）\n`);
    } else {
      process.stderr.write(`  ✅ 第 ${i + 1} 轮完成\n`);
    }
  }

  process.stderr.write(`\n[pty] 全部完成，退出\n`);
  pty.write("/quit\r");
  setTimeout(() => process.exit(0), 500);
}

main().catch(e => {
  process.stderr.write(`[pty] 异常: ${e}\n`);
  process.exit(1);
});

setTimeout(() => {
  process.stderr.write(`\n[pty] ⏰ 全局超时\n最后输出:\n${stripAnsi(buffer).slice(-800)}\n`);
  process.exit(1);
}, 120000);
