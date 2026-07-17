/**
 * PTY 后端封装 — node-pty 优先，child_process.spawn 降级
 *
 * 对外暴露 IPtyLike 接口 + spawnPty() 工厂函数。
 * node-pty 加载失败时自动降级为 SpawnPtyAdapter（无 ANSI / 交互能力）。
 */

import { createRequire } from "node:module";
import { spawn as cpSpawn, type ChildProcess } from "node:child_process";

const _cjsRequire = createRequire(import.meta.url);

/** 统一的 PTY-like 接口 */
export interface IPtyLike {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
}

export interface SpawnPtyOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

/** 允许透传到子进程的环境变量白名单（大写匹配） */
const ENV_WHITELIST = new Set([
  "PATH", "HOME", "USER", "USERNAME", "USERPROFILE", "SHELL",
  "LANG", "LC_ALL", "LC_CTYPE",
  "TERM", "COLORTERM", "TMPDIR", "TMP", "TEMP",
  "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT",
  "JAVA_HOME", "NODE_PATH", "PYTHONPATH", "GOPATH", "GOROOT",
  "RUSTUP_HOME", "CARGO_HOME", "NVM_DIR", "CONDA_PREFIX",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA",
]);

/**
 * 从 process.env 中按白名单过滤出安全的环境变量，
 * 并强制 TERM=xterm-256color。
 */
export function buildSafeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && ENV_WHITELIST.has(k.toUpperCase())) {
      env[k] = v;
    }
  }
  env["TERM"] = "xterm-256color";
  if (extra) {
    Object.assign(env, extra);
  }
  return env;
}

/** node-pty 模块类型（动态加载用） */
interface NodePtyModule {
  spawn(file: string, args: string[] | string, options: Record<string, unknown>): {
    pid: number;
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
    write(data: string): void;
    kill(signal?: string): void;
    resize(cols: number, rows: number): void;
  };
}

let _ptyModule: NodePtyModule | null | undefined;

function loadNodePty(): NodePtyModule | null {
  if (_ptyModule !== undefined) return _ptyModule;
  try {
    _ptyModule = _cjsRequire("node-pty") as NodePtyModule;
    return _ptyModule;
  } catch {
    _ptyModule = null;
    return null;
  }
}

/**
 * 工厂函数：创建 PTY 实例。
 * 优先使用 node-pty（完整 PTY），失败则降级到 child_process.spawn。
 */
export function spawnPty(
  command: string,
  args: string[],
  opts: SpawnPtyOptions,
): IPtyLike {
  const pty = loadNodePty();
  if (pty) {
    return pty.spawn(command, args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env,
    }) as unknown as IPtyLike;
  }
  return new SpawnPtyAdapter(command, args, opts);
}

/**
 * child_process.spawn 降级适配器
 * 无 PTY 能力（不支持交互式命令 / ANSI 色彩），但基础 run/logs/kill 可用。
 */
class SpawnPtyAdapter implements IPtyLike {
  readonly pid: number;
  private _child: ChildProcess;
  private _dataCbs: Array<(data: string) => void> = [];
  private _exitCbs: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  private _exited = false;

  constructor(command: string, args: string[], opts: SpawnPtyOptions) {
    this._child = cpSpawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.pid = this._child.pid ?? 0;

    this._child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      for (const cb of this._dataCbs) cb(text);
    });
    this._child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      for (const cb of this._dataCbs) cb(text);
    });
    this._child.on("exit", (code, signal) => {
      this._exited = true;
      const exitCode = code ?? (signal ? 128 + (typeof signal === "number" ? signal : 0) : 1);
      for (const cb of this._exitCbs) cb({ exitCode, signal: typeof signal === "number" ? signal : undefined });
    });
    this._child.on("error", () => {
      if (!this._exited) {
        this._exited = true;
        for (const cb of this._exitCbs) cb({ exitCode: 127 });
      }
    });
  }

  onData(cb: (data: string) => void): void {
    this._dataCbs.push(cb);
  }

  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    if (this._exited) {
      cb({ exitCode: this._child.exitCode ?? 1 });
    } else {
      this._exitCbs.push(cb);
    }
  }

  write(data: string): void {
    if (!this._exited && this._child.stdin?.writable) {
      this._child.stdin.write(data);
    }
  }

  kill(signal?: string): void {
    if (!this._exited) {
      try {
        this._child.kill((signal as NodeJS.Signals) || "SIGTERM");
      } catch { /* already dead */ }
    }
  }

  resize(_cols: number, _rows: number): void {
    // spawn 模式不支持 resize，静默忽略
  }
}
