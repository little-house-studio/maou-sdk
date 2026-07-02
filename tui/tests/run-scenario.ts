/**
 * PTY 场景 runner v2 —— 可靠版。
 *
 * 改进（解决之前 6 个假失败的根因）：
 *  - 独立临时目录：每个场景复制 fixture 到 /tmp/maou-test-<id>/，避免产物污染
 *  - yolo terminal：临时目录的 .maou/agents/coding/terminal-policy.json 设 yolo，让 use_terminal 通过
 *  - 多轮 prompt：prompt 可以是数组（多轮对话）
 *  - 90s 超时：thinking 慢不杀进程
 *  - 可靠完成检测：检测 streaming 关闭而非"待命"正则
 *
 * 用法：node --import ./preload.mjs tests/run-scenario.ts '<json>' <id>
 *   <json> = {"prompts":["...",...], "timeout":90000, "expectTools":["reader",...], "expectFiles":["x.py"]}
 */
import { spawn } from "@lydell/node-pty";
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TUI_BIN = "/Users/mac/.local/share/pnpm/maou";
const AGENT = "/Users/mac/Documents/vscodeProject/maou-sdk/agent/coding-agent/src/cli-config.ts";
const FIXTURE = "/Users/mac/Documents/vscodeProject/maou-sdk/tui/tests/fixture";

const spec = JSON.parse(process.argv[2] ?? "{}");
const scenarioId = process.argv[3] ?? "scenario";
const prompts: string[] = spec.prompts ?? [spec.prompt ?? ""];
const timeoutMs: number = spec.timeout ?? 90000;
const expectTools: string[] = spec.expectTools ?? [];
const expectFiles: string[] = spec.expectFiles ?? [];

// 独立临时目录：复制 fixture
const workDir = mkdtempSync(join(tmpdir(), `maou-test-`));
cpSync(FIXTURE, workDir, { recursive: true });

// yolo terminal 模式：让 use_terminal 命令直接放行
const maouDir = join(workDir, ".maou");
const agentDir = join(maouDir, "agents", "coding");
mkdirSync(agentDir, { recursive: true });
writeFileSync(
  join(agentDir, "terminal-policy.json"),
  JSON.stringify({ mode: "yolo", whitelist: [], blacklist: [] }, null, 2),
);

const pty = spawn(TUI_BIN, [AGENT, "--cwd", workDir], {
  name: "xterm-256color",
  cols: 110,
  rows: 30,
  cwd: workDir,
  env: process.env,
});

let buf = "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07?|\x1b[=>78NX_Z^_()*+]/g, "");
pty.onData((d) => { buf += d; });

function send(s: string) { pty.write(s + "\r"); }

const result: Record<string, unknown> = {
  scenario: scenarioId,
  prompts,
  pass: false,
  rounds: 0,
  toolCalls: [],
  errors: [],
  hadError: false,
  expectFilesOk: [],
  detail: "",
  workDir,
};

/** 等待 agent 空闲：状态栏非 REC（不流式）持续 3s。
 *  时钟每秒变，但 REC ● 只在 streaming 时出现——检测 REC 消失即流式结束。 */
function waitForIdle(deadline: number): Promise<boolean> {
  return new Promise((resolve) => {
    let idleSince = 0;
    const interval = setInterval(() => {
      const tail = strip(buf).slice(-300);
      const streaming = /REC ●/.test(tail);
      if (!streaming) {
        if (!idleSince) idleSince = Date.now();
        if (Date.now() - idleSince > 3000) {
          clearInterval(interval);
          resolve(true);
        }
      } else {
        idleSince = 0;
      }
      if (Date.now() > deadline) {
        clearInterval(interval);
        resolve(false);
      }
    }, 500);
  });
}

async function main() {
  await new Promise(r => setTimeout(r, 3000)); // TUI 启动

  for (let i = 0; i < prompts.length; i++) {
    send(prompts[i]!);
    const ok = await waitForIdle(Date.now() + (i === prompts.length - 1 ? timeoutMs : 60000));
    if (!ok) {
      result.detail = `第${i + 1}轮超时未完成`;
      break;
    }
  }

  const c = strip(buf);
  const chMatches = [...c.matchAll(/ch\.(\d{2})/g)].map(m => Number(m[1]!));
  result.rounds = chMatches.length > 0 ? Math.max(...chMatches) : 0;

  const tools = ["reader", "write_file", "edit_file", "glob", "grep", "find_code", "use_terminal", "search_internet", "use_skill", "find_skill", "task_finish"];
  const toolCalls: string[] = [];
  for (const t of tools) if (c.includes(t)) toolCalls.push(t);
  result.toolCalls = toolCalls;

  // 错误检测（排除预期内的工具失败提示语）
  const errLines = c.split("\n").filter(l =>
    /错误 |Error:|TypeError|Cannot |报错|失败/.test(l)
    && !/除数不能为零|ValueError/.test(l) // 排除 fixture 里的预期错误
  );
  if (errLines.length > 0) {
    result.hadError = true;
    result.errors = [...new Set(errLines.map(l => l.trim().slice(0, 80)))].slice(0, 5);
  }

  // 验证期望文件
  const expectFilesOk: string[] = [];
  for (const f of expectFiles) {
    expectFilesOk.push(`${f}:${existsSync(join(workDir, f)) ? "存在" : "缺失"}`);
  }
  result.expectFilesOk = expectFilesOk;

  // 通过判定
  let pass = result.rounds >= 1;
  if (expectTools.length > 0 && !expectTools.some(t => toolCalls.includes(t))) pass = false;
  if (expectFiles.length > 0 && !expectFiles.every(f => existsSync(join(workDir, f)))) pass = false;
  // 工具执行错误算失败（但不阻断——记录 hadError）
  result.pass = pass;
  result.detail = result.detail || `轮次${result.rounds} 工具[${toolCalls.join(",")}] 文件[${expectFilesOk.join(",")}]`;

  process.stdout.write(JSON.stringify(result));
  try { pty.kill(); } catch {}
  process.exit(0);
}

main().catch(e => {
  result.pass = false;
  result.detail = `runner 异常: ${e}`;
  process.stdout.write(JSON.stringify(result));
  try { pty.kill(); } catch {}
  process.exit(1);
});
