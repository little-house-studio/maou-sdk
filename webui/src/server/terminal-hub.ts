/**
 * TerminalHub —— Web 内嵌交互终端（node-pty）。
 * spawn 失败时通过 WS 回错误，绝不拖垮 HTTP 进程。
 */

// monorepo 使用 @lydell/node-pty（官方 node-pty 在部分 Node24 环境 posix_spawnp 失败）
import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import type { WebSocket } from "ws";

export interface TerminalSession {
  id: string;
  pty: IPty;
  cwd: string;
}

function shellCandidates(): Array<{ file: string; args: string[] }> {
  if (platform() === "win32") {
    return [
      { file: "powershell.exe", args: ["-NoLogo"] },
      { file: "cmd.exe", args: [] },
    ];
  }
  const envShell = process.env.SHELL?.trim();
  const list: Array<{ file: string; args: string[] }> = [];
  // 先非 login（避免 -l 在部分环境下 posix_spawnp 失败）
  if (envShell && existsSync(envShell)) {
    list.push({ file: envShell, args: [] });
  }
  for (const sh of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (existsSync(sh) && !list.some((c) => c.file === sh)) {
      list.push({ file: sh, args: [] });
    }
  }
  return list;
}

function spawnWithFallback(
  cwd: string,
  cols: number,
  rows: number,
): { pty: IPty; file: string } {
  const candidates = shellCandidates();
  const errors: string[] = [];
  // 精简 env：过大的 env 偶发导致 spawn 失败
  const env: Record<string, string> = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
  } as Record<string, string>;

  for (const { file, args } of candidates) {
    try {
      const pty = spawnPty(file, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
      return { pty, file };
    } catch (e) {
      errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(
    `无法启动终端（node-pty）。尝试：${errors.join(" | ") || "无可用 shell"}`,
  );
}

export class TerminalHub {
  private sessions = new Map<string, TerminalSession>();
  private seq = 0;

  create(opts: {
    cwd?: string;
    cols?: number;
    rows?: number;
    onData: (data: string) => void;
    onExit: (code: number, signal?: number) => void;
  }): TerminalSession {
    const id = `term-${++this.seq}-${Date.now().toString(36)}`;
    const cwd = opts.cwd || process.cwd();
    const cols = Math.max(2, opts.cols ?? 80);
    const rows = Math.max(1, opts.rows ?? 24);

    const { pty, file } = spawnWithFallback(cwd, cols, rows);

    pty.onData((data) => {
      try {
        opts.onData(data);
      } catch {
        /* ignore client write errors */
      }
    });
    pty.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      try {
        opts.onExit(exitCode, signal);
      } catch {
        /* ignore */
      }
    });

    const session: TerminalSession = { id, pty, cwd };
    this.sessions.set(id, session);
    // 首行提示用 onData 注入会乱序；由调用方 send ready 后可选 write
    void file;
    return session;
  }

  write(id: string, data: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    try {
      s.pty.write(data);
      return true;
    } catch {
      return false;
    }
  }

  resize(id: string, cols: number, rows: number): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    try {
      s.pty.resize(Math.max(2, cols), Math.max(1, rows));
      return true;
    } catch {
      return false;
    }
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    try {
      s.pty.kill();
    } catch {
      /* ignore */
    }
    this.sessions.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}

/** 绑定一条 WebSocket 到终端会话生命周期 */
export function attachTerminalSocket(
  hub: TerminalHub,
  ws: WebSocket,
  cwd?: string,
): void {
  let termId: string | null = null;

  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
  };

  ws.on("message", (raw) => {
    try {
      let msg: {
        type?: string;
        data?: string;
        cols?: number;
        rows?: number;
        cwd?: string;
      };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === "create") {
        if (termId) hub.close(termId);
        try {
          const session = hub.create({
            cwd: msg.cwd || cwd,
            cols: msg.cols,
            rows: msg.rows,
            onData: (data) => send({ type: "data", data }),
            onExit: (code) => {
              send({ type: "exit", code });
              termId = null;
            },
          });
          termId = session.id;
          send({ type: "ready", id: session.id, cwd: session.cwd });
        } catch (e) {
          send({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
        return;
      }

      if (msg.type === "input" && termId && typeof msg.data === "string") {
        hub.write(termId, msg.data);
        return;
      }

      if (
        msg.type === "resize" &&
        termId &&
        typeof msg.cols === "number" &&
        typeof msg.rows === "number"
      ) {
        hub.resize(termId, msg.cols, msg.rows);
        return;
      }

      if (msg.type === "close" && termId) {
        hub.close(termId);
        termId = null;
      }
    } catch (e) {
      send({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  ws.on("close", () => {
    if (termId) hub.close(termId);
  });

  ws.on("error", () => {
    if (termId) hub.close(termId);
  });
}
