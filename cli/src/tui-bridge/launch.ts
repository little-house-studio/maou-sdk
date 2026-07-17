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
  const exe = process.platform === "win32" ? ".exe" : "";
  const names = [
    `maou-tui-ratatui${exe}`,
    "maou-tui-ratatui.exe", // cross-build leftover
    "maou-tui-ratatui",
  ];
  const dirs = [
    join(cliRoot, "tui-ratatui/target/release"),
    join(cliRoot, "tui-ratatui/target/debug"),
    join(process.cwd(), "tui-ratatui/target/release"),
    join(process.cwd(), "tui-ratatui/target/debug"),
    join(process.env.USERPROFILE || process.env.HOME || "", ".maou", "bin"),
  ];
  const candidates: string[] = [];
  for (const d of dirs) {
    for (const n of names) candidates.push(join(d, n));
  }
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
  /** 子进程/IPC 已死（勿再 pushState） */
  isDead?: () => boolean;
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

  /** 子进程/管道已死后禁止再写，否则 Node 对 closed pipe 的 write 会抛 uncaught EPIPE */
  let dead = false;
  const markDead = (why?: string) => {
    if (dead) return;
    dead = true;
    if (why) {
      try {
        process.stderr.write(`[maou] ratatui ipc closed (${why})\n`);
      } catch {
        /* ignore */
      }
    }
  };
  child.on("exit", (code, signal) => {
    markDead(
      signal
        ? `signal ${signal}`
        : `exit ${code ?? "?"}`,
    );
  });
  child.on("error", (err) => {
    markDead(`child error: ${err?.message ?? err}`);
  });
  if (ipc && typeof (ipc as NodeJS.EventEmitter).on === "function") {
    // 关键：无 error 监听时 write 到已断管道 → uncaughtException(EPIPE) → 整进程闪退
    ipc.on("error", (err: NodeJS.ErrnoException) => {
      markDead(err?.code === "EPIPE" ? "EPIPE" : err?.message ?? "ipc error");
    });
  }

  const send = (msg: Record<string, unknown>) => {
    if (dead) return;
    if (!ipc || ipc.destroyed || !ipc.writable) {
      markDead("not writable");
      return;
    }
    try {
      const line = `${JSON.stringify(msg)}\n`;
      // 回调错误已由 ipc.on('error') 吞；同步 throw 也兜底
      ipc.write(line, (err) => {
        if (err) markDead(err.message);
      });
    } catch (err) {
      markDead(err instanceof Error ? err.message : String(err));
    }
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
    // 尽量先送 quit；再标死并 SIGTERM
    try {
      if (!dead && ipc && !ipc.destroyed && ipc.writable) {
        try {
          ipc.write(`${JSON.stringify({ type: "quit" })}\n`);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    markDead("kill");
    try {
      if (!child.killed) child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };

  return {
    child,
    send,
    wait,
    kill,
    /** 供 bridge 在子进程死后立刻停 push */
    isDead: () => dead,
  };
}
