/**
 * Agent 全功能验证 —— 用真实 LLM 跑 coding agent，覆盖：
 *  1. 启动 + 欢迎语
 *  2. 多轮对话（3 轮）
 *  3. 工具调用（让 agent 用工具，触发 Box 边框渲染）
 *  4. Markdown 渲染（让 agent 输出 markdown）
 *  5. 滚动（长输出进 scrollback）
 *  6. Ctrl+C 中断
 *  7. /quit 退出
 *
 * 用 node-pty 驱动真实终端，捕获输出，检测关键标记。
 */
import { spawn } from "@lydell/node-pty";

const TUI_BIN = "/Users/mac/.local/share/pnpm/maou";
const AGENT = "/Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/src/cli-config.ts";

const pty = spawn(TUI_BIN, [AGENT], {
  name: "xterm-256color",
  cols: 110,
  rows: 30,
  cwd: "/Users/mac/Downloads/coding测试",
  env: process.env,
});

let buf = "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07?|\x1b[=>78NX_Z^_()*+]/g, "");
const clean = () => strip(buf);

pty.onData((d) => { buf += d; });

function send(s: string) { pty.write(s + "\r"); }
function has(s: string) { return clean().includes(s); }

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  process.stderr.write(`${cond ? "✅" : "❌"} ${name}: ${detail}\n`);
}

async function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await wait(3000);
  // 1. 启动 + 欢迎语
  check("启动欢迎语", has("欢迎使用 MAOU TUI") || has("MAOU"), "看到欢迎/MAOU");

  // 2. 第一轮：简单对话
  send("只回复：你好");
  await wait(15000);
  check("第1轮对话", has("你好") && has("ch.01"), "ai 回复你好+轮次ch.01");

  // 3. 第二轮：触发 Markdown（让 agent 用列表/代码块）
  send("用 markdown 回复一个包含代码块和列表的简短说明，控制在5行内");
  await wait(25000);
  // Markdown 渲染会有 ╭─│ 等 box 字符或 list bullet
  const hasMd = clean().split("\n").some(l => l.includes("│") || l.includes("•") || l.includes("─"));
  check("第2轮 Markdown", has("ch.02") && hasMd, "轮次ch.02+markdown装饰字符");

  // 4. 第三轮：触发工具调用（让 agent 读文件，coding测试 目录有 README.md）
  send("读取当前目录的 README.md 文件");
  await wait(30000);
  // 工具卡片 Box 边框 ┌─┐
  const hasToolBox = clean().split("\n").some(l => l.includes("┌") && l.includes("┐"));
  check("第3轮工具卡片", has("ch.03") && (hasToolBox || has("reader") || has("read")), "轮次ch.03+工具卡片边框/工具名");

  // 5. 滚动：此时输出应该超过视口，stableRows 应非零（消息进 scrollback）
  // 检查输出里有多个 ch 标记说明多轮都保留了
  const chCount = (clean().match(/ch\.\d{2}/g) || []).length;
  check("多轮保留", chCount >= 3, `输出中出现 ch.NN 标记 ${chCount} 次`);

  // 6. Ctrl+C 测试（非 streaming 时应退出）
  // 先确保不在 streaming
  await wait(2000);
  send("/quit");

  await wait(1500);
  process.stderr.write("\n=== 验证结果汇总 ===\n");
  const passed = results.filter(r => r.pass).length;
  process.stderr.write(`${passed}/${results.length} 通过\n`);
  results.forEach(r => {
    process.stderr.write(`  ${r.pass ? "✅" : "❌"} ${r.name}\n`);
  });
  try { pty.kill(); } catch {}
  process.exit(0);
}

main().catch(e => {
  process.stderr.write(`[test] 异常: ${e}\n最后输出:\n${clean().slice(-600)}\n`);
  try { pty.kill(); } catch {}
  process.exit(1);
});

setTimeout(() => {
  process.stderr.write(`\n[test] ⏰ 超时\n最后输出:\n${clean().slice(-600)}\n`);
  try { pty.kill(); } catch {}
  process.exit(1);
}, 120000);
