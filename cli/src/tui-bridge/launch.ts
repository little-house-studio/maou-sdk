/**
 * 启动 Ratatui 后端。
 *
 * stdio 布局（关键：stdin 必须是 TTY，否则 crossterm 无法 init input reader）:
 *   0 stdin  — inherit TTY（键盘 / raw mode）
 *   1 stdout — inherit TTY（绘制；Rust 侧也可走 /dev/tty）
 *   2 stderr — pipe（TUI → Node JSONL + 日志）
 *   3 fd3   — pipe（Node → TUI JSONL 协议，env MAOU_TUI_IPC_FD=3）
 *
 * Ink 路径不经过此文件。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { Writable, Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Protocol FD index in child.stdio (stdio[3]). */
const IPC_FD = 3;

export interface RatatuiLaunchOpts {
  cwd?: string;
  product?: string;
  model?: string;
  agent?: string;
  /** 二进制绝对路径；默认探测 */
  binaryPath?: string;
}

export function resolveRatatuiBinary(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  if (process.env.MAOU_TUI_BIN && existsSync(process.env.MAOU_TUI_BIN)) {
    return process.env.MAOU_TUI_BIN;
  }
  // cli/src/tui-bridge → cli/tui-ratatui/target/release|debug
  // dist/tui-bridge → 同上 ../.. = cli
  const cliRoot = resolve(__dirname, "../..");
  const candidates = [
    join(cliRoot, "tui-ratatui/target/release/maou-tui-ratatui"),
    join(cliRoot, "tui-ratatui/target/debug/maou-tui-ratatui"),
    join(process.cwd(), "tui-ratatui/target/release/maou-tui-ratatui"),
    join(process.cwd(), "tui-ratatui/target/debug/maou-tui-ratatui"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export type ProtocolHandler = (msg: Record<string, unknown>) => void | Promise<void>;

export interface RatatuiSession {
  child: ChildProcess;
  send: (msg: Record<string, unknown>) => void;
  wait: () => Promise<number>;
  kill: () => void;
}

/**
 * Spawn Ratatui TUI with TTY-inherited stdin/stdout and protocol on fd3.
 */
export function spawnRatatui(
  opts: RatatuiLaunchOpts,
  onMessage: ProtocolHandler,
): RatatuiSession {
  const bin = resolveRatatuiBinary(opts.binaryPath);
  if (!bin) {
    throw new Error(
      "找不到 maou-tui-ratatui 二进制。\n" +
        "  请先编译：cd maou-sdk/cli && npm run build:tui-ratatui\n" +
        "  或设置 MAOU_TUI_BIN=/path/to/maou-tui-ratatui\n" +
        "  回退 Ink：MAOU_TUI=ink maou coding",
    );
  }

  process.stderr.write(`[maou] tui=ratatui binary=${bin}\n`);

  // Logo 版本号：与 Ink maou-logo / package.json 对齐
  let cliVersion = process.env.MAOU_CLI_VERSION || process.env.npm_package_version || "";
  if (!cliVersion) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"),
      ) as { version?: string };
      if (pkg.version) cliVersion = pkg.version;
    } catch {
      /* Rust 侧有默认 0.1a */
    }
  }

  const child = spawn(bin, [], {
    cwd: opts.cwd || process.cwd(),
    env: {
      ...process.env,
      MAOU_TUI_IPC_FD: String(IPC_FD),
      ...(cliVersion ? { MAOU_CLI_VERSION: cliVersion } : {}),
    },
    // inherit TTY for keyboard + paint; pipe stderr (out) + fd3 (in)
    stdio: ["inherit", "inherit", "pipe", "pipe"],
  });

  const err = child.stderr as Readable | null;
  if (err) {
    const rl = createInterface({ input: err, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t.startsWith("{")) {
        if (t) process.stderr.write(`[ratatui] ${t}\n`);
        return;
      }
      try {
        const msg = JSON.parse(t) as Record<string, unknown>;
        void onMessage(msg);
      } catch {
        process.stderr.write(`[ratatui] ${t}\n`);
      }
    });
  }

  const ipc = child.stdio[IPC_FD] as Writable | null | undefined;

  const send = (msg: Record<string, unknown>) => {
    if (!ipc?.writable) return;
    ipc.write(`${JSON.stringify(msg)}\n`);
  };

  send({
    type: "hello",
    product: opts.product ?? "coding",
    model: opts.model ?? "",
    agent: opts.agent ?? "main",
    cwd: opts.cwd || process.cwd(),
  });

  const wait = () =>
    new Promise<number>((resolvePromise) => {
      child.on("exit", (code) => resolvePromise(code ?? 0));
    });

  const kill = () => {
    try {
      send({ type: "quit" });
    } catch {
      /* ignore */
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };

  return { child, send, wait, kill };
}
