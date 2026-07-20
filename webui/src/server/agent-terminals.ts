/**
 * Agent 终端会话 —— 对接 @little-house-studio/terminal-engine
 * （use_terminal 实际跑命令的那套，不是旁路 node-pty）
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WebSocket } from "ws";

export type TerminalInfo = {
  id: string;
  agentName: string;
  command: string;
  description: string;
  state: string;
  exitCode: number | null;
  cwd: string;
  createdAt: string;
  updatedAt: string;
};

type Engine = {
  initEngine: (logDir?: string) => void;
  setPersistPath: (path: string) => void;
  list: (agentName?: string) => Array<{
    id: string;
    agentName: string;
    command: string;
    description: string;
    state: string;
    exitCode: number | null;
    cwd: string;
    createdAt: string;
    updatedAt: string;
  }>;
  logs: (id: string, agentName: string, lines?: number) => Promise<string>;
  write: (id: string, agentName: string, data: string) => Promise<void>;
  stop: (id: string, agentName: string) => Promise<void>;
};

let engine: Engine | null = null;
let initTried = false;

export function initAgentTerminalEngine(maouRoot?: string): boolean {
  if (engine) return true;
  if (initTried && !engine) return false;
  initTried = true;
  try {
    const req = createRequire(import.meta.url);
    const mod = req("@little-house-studio/terminal-engine") as Engine;
    const root = maouRoot ?? join(homedir(), ".maou");
    try {
      mod.initEngine(join(root, "logs", "terminal-engine"));
    } catch {
      /* already inited */
    }
    try {
      mod.setPersistPath(join(root, "terminals"));
    } catch {
      /* optional */
    }
    engine = mod;
    return true;
  } catch (e) {
    console.warn(
      "[webui] terminal-engine 不可用，Agent 终端面板将为空:",
      e instanceof Error ? e.message : e,
    );
    engine = null;
    return false;
  }
}

function eng(): Engine {
  if (!engine) throw new Error("terminal-engine 未初始化");
  return engine;
}

export function listAgentTerminals(agentName?: string): TerminalInfo[] {
  if (!engine) return [];
  try {
    const raw = agentName ? engine.list(agentName) : engine.list();
    return (raw ?? []).map((t) => ({
      id: t.id,
      agentName: t.agentName,
      command: t.command ?? "",
      description: t.description ?? "",
      state: t.state ?? "",
      exitCode: t.exitCode ?? null,
      cwd: t.cwd ?? "",
      createdAt: t.createdAt ?? "",
      updatedAt: t.updatedAt ?? "",
    }));
  } catch {
    return [];
  }
}

export async function getAgentTerminalLogs(
  id: string,
  agentName: string,
  lines = 8000,
): Promise<string> {
  if (!engine) return "";
  try {
    return await Promise.race([
      eng().logs(id, agentName, lines),
      new Promise<string>((r) => setTimeout(() => r(""), 5000)),
    ]);
  } catch {
    return "";
  }
}

export async function writeAgentTerminal(
  id: string,
  agentName: string,
  data: string,
): Promise<void> {
  await eng().write(id, agentName, data);
}

export async function stopAgentTerminal(
  id: string,
  agentName: string,
): Promise<void> {
  await eng().stop(id, agentName);
}

/**
 * WebSocket：附着到指定 agent 终端，轮询 logs 推增量；stdin 走 write。
 */
export function attachAgentTerminalSocket(
  ws: WebSocket,
  opts: { id: string; agentName: string; pollMs?: number },
): void {
  const pollMs = opts.pollMs ?? 250;
  let last = "";
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
  };

  const tick = async () => {
    if (closed) return;
    try {
      const full = await getAgentTerminalLogs(opts.id, opts.agentName, 12000);
      if (full.length >= last.length && full.startsWith(last)) {
        const delta = full.slice(last.length);
        if (delta) send({ type: "data", data: delta });
        last = full;
      } else if (full !== last) {
        // 日志被截断/重置：全量刷新
        send({ type: "reset", data: full });
        last = full;
      }
      const list = listAgentTerminals(opts.agentName);
      const info = list.find((t) => t.id === opts.id);
      if (info) {
        send({
          type: "status",
          state: info.state,
          exitCode: info.exitCode,
          command: info.command,
          description: info.description,
        });
        if (
          info.state === "exited" ||
          info.state === "failed" ||
          info.state === "stopped" ||
          info.exitCode != null
        ) {
          // 再推一次最终日志后停轮询
          send({ type: "exit", code: info.exitCode });
        }
      }
    } catch (e) {
      send({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  void (async () => {
    if (!engine) {
      send({
        type: "error",
        message: "terminal-engine 不可用（原生模块未加载）",
      });
      return;
    }
    const initial = await getAgentTerminalLogs(opts.id, opts.agentName, 12000);
    last = initial;
    send({
      type: "ready",
      id: opts.id,
      agentName: opts.agentName,
      data: initial,
    });
    timer = setInterval(() => void tick(), pollMs);
  })();

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string;
        data?: string;
      };
      if (msg.type === "input" && typeof msg.data === "string") {
        void writeAgentTerminal(opts.id, opts.agentName, msg.data).catch((e) => {
          send({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        });
      }
      if (msg.type === "stop") {
        void stopAgentTerminal(opts.id, opts.agentName).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  });

  const cleanup = () => {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
