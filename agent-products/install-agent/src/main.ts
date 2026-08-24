import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  createStandardAgentDeps,
  getDefaultPresetFromConfigStore,
  runAgentCli,
} from "@little-house-studio/agent";
import type { StreamEvent } from "@little-house-studio/types";
import {
  resolveUserMaouRoot,
  resolveUserInstallRoot,
  resolveUserInstallSessionsDir,
} from "@little-house-studio/types";
import { createInstallAgent } from "./create.js";
import { DEFAULT_INSTALL_AGENT_NAME } from "./defaults.js";
import { parseAiinstallArgs, defaultInstallDir } from "./parse-args.js";
import { formatEnvProbe, probeEnvironment } from "./env-probe.js";
import { ensureInstallApiConfigured } from "./setup.js";
import { loadLastSessionId, saveLastSessionId } from "./session-pointer.js";

export interface RunAiinstallOptions {
  argv?: string[];
  repair?: boolean;
  firstMessage?: string;
  dir?: string;
  /** 单测 / 脚本：不进入交互 REPL */
  once?: boolean;
}

const HELP = `aiinstall — 安装员（无 TUI）

用法:
  aiinstall <链接或需求>
  aiinstall <链接> --dir <目录>
  aiinstall --repair
  aiinstall --new

选项:
  --dir <path>   安装目录（否则会询问）
  --repair       检修本机运行时，不问安装目录
  --new          新开会话
  -h, --help     帮助
`;

export function applyInstallRuntimeEnv(): void {
  process.env.MAOU_TERMINAL = "mini";
  process.env.MAOU_DCG_OPTIONAL = "1";
}

function expandPath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

function printStreamEvent(ev: StreamEvent, out: NodeJS.WritableStream): void {
  if (ev.type === "assistant_delta") {
    const d = ev.delta ?? ev.content ?? "";
    if (d) out.write(String(d));
    return;
  }
  if (ev.type === "assistant") {
    const c = ev.content ?? "";
    if (c) out.write(String(c).endsWith("\n") ? String(c) : `${c}\n`);
    return;
  }
  if (ev.type === "tool_call") {
    const tool = ev.tool as { name?: string; parameters?: { command?: string; description?: string } } | undefined;
    const name = tool?.name ?? "tool";
    const hint =
      tool?.parameters?.description ||
      (typeof tool?.parameters?.command === "string"
        ? tool.parameters.command.slice(0, 80)
        : "");
    process.stderr.write(`→ ${name}${hint ? ` ${hint}` : ""}\n`);
    return;
  }
  if (ev.type === "error") {
    const msg = ev.message ?? ev.content ?? "error";
    process.stderr.write(`${msg}\n`);
  }
}

async function askInstallDir(defaultDir: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) return defaultDir;
  const rl = readline.createInterface({ input, output });
  try {
    const ans = (await rl.question(`安装到哪个目录？ [${defaultDir}] `)).trim();
    return expandPath(ans || defaultDir);
  } finally {
    rl.close();
  }
}

function composeFirstMessage(opts: {
  task: string;
  dest?: string;
  repair: boolean;
  seeded?: string;
}): string {
  const probe = probeEnvironment(opts.dest);
  const parts = [
    "[本机探测]",
    formatEnvProbe(probe, opts.dest),
    "",
  ];
  if (opts.repair) {
    parts.push("任务类型：检修本机运行时。不要询问安装目录。");
    parts.push("预编译安装形态下不要跑全量包管理器安装或从源码编译。");
  } else if (opts.dest) {
    parts.push(`安装目录：${opts.dest}`);
  }
  if (opts.seeded) {
    parts.push("", opts.seeded);
  }
  if (opts.task) {
    parts.push("", `用户任务：${opts.task}`);
  } else if (opts.repair && !opts.seeded) {
    parts.push("", "用户任务：检修本机，把缺的修好，或给出用户只需执行的一条命令。");
  }
  return parts.join("\n");
}

export async function runAiinstallMain(opts: RunAiinstallOptions = {}): Promise<number> {
  applyInstallRuntimeEnv();
  const parsed = parseAiinstallArgs(opts.argv ?? []);
  if (parsed.help) {
    output.write(HELP);
    return 0;
  }

  const ok = await ensureInstallApiConfigured();
  if (!ok) {
    process.stderr.write("API 未配置，无法启动。\n");
    return 1;
  }

  const repair = opts.repair === true || parsed.repair;
  const maouRoot = resolveUserMaouRoot();
  const dataRoot = resolveUserInstallRoot(maouRoot);
  mkdirSync(dataRoot, { recursive: true });

  let dest: string | undefined = opts.dir ?? parsed.dir;
  if (dest) dest = expandPath(dest);
  if (!repair && !dest && parsed.task) {
    dest = await askInstallDir(defaultInstallDir(parsed.task));
  }
  if (dest) mkdirSync(dest, { recursive: true });

  const sessionsDir = resolveUserInstallSessionsDir(maouRoot);
  const deps = createStandardAgentDeps(dataRoot, maouRoot, {
    reviewerOnMissingPreset: "approve",
    sessionsDir,
  });
  const handle = createInstallAgent({
    maouRoot,
    dataRoot,
    projectRoot: dest ?? dataRoot,
    configStore: deps.configStore,
    sessionStore: deps.sessionStore,
    toolRegistry: deps.toolRegistry,
    llmClient: deps.llmClient,
    log: () => {},
    enablePostLogger: false,
  });

  const preset = getDefaultPresetFromConfigStore(deps.configStore);
  if (!preset) {
    process.stderr.write("未找到可用模型 preset。\n");
    return 1;
  }

  let sessionId = parsed.isNew
    ? handle.startSession(parsed.task || (repair ? "repair" : "install"))
    : loadLastSessionId(dataRoot, deps.sessionStore) ??
      handle.startSession(parsed.task || (repair ? "repair" : "install"));
  saveLastSessionId(dataRoot, sessionId);

  const first =
    parsed.task || repair || opts.firstMessage
      ? composeFirstMessage({
          task: parsed.task,
          dest,
          repair,
          seeded: opts.firstMessage,
        })
      : "";

  const runTurn = async (text: string): Promise<void> => {
    output.write("\n");
    await runAgentCli(text, {
      runtime: handle.runtime,
      sessionId,
      preset: preset as unknown as Record<string, unknown>,
      sandboxMode: "auto",
      initAgentName: DEFAULT_INSTALL_AGENT_NAME,
      source: "aiinstall",
      onEvent: (ev) => printStreamEvent(ev, output),
    });
    output.write("\n");
  };

  if (first.trim()) {
    await runTurn(first);
  } else if (!input.isTTY) {
    process.stderr.write("请提供链接或需求：aiinstall <链接>\n");
    return 1;
  } else {
    output.write("安装员已就绪。输入链接或需求；/exit 离开。\n");
  }

  if (opts.once || !input.isTTY || !output.isTTY) return 0;

  const rl = readline.createInterface({ input, output, terminal: true });
  const prompt = () => rl.question("aiinstall> ");
  try {
    while (true) {
      const line = (await prompt()).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      if (line === "/help") {
        output.write("  /new   新会话\n  /exit  离开\n  /help  帮助\n");
        continue;
      }
      if (line === "/new") {
        sessionId = handle.startSession("install");
        saveLastSessionId(dataRoot, sessionId);
        output.write("已新开会话。\n");
        continue;
      }
      await runTurn(line);
    }
  } finally {
    rl.close();
  }
  return 0;
}
