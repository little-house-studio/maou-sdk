/**
 * Agent 终端会话 —— 对接 TerminalBackend（full Rust / mini Node）
 * 优先 subscribe 流式；旧 .node 或 mini 回退 250ms 轮询 logs。
 */

import { join } from "node:path";
import { homedir } from "node:os";
import type { WebSocket } from "ws";
import {
  getActiveBackend,
  initTerminalEngine,
  resolveTerminalPersistPath,
  type TerminalInfo as BackendInfo,
} from "@little-house-studio/tools";

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
  kind?: "agent" | "human";
};

let inited = false;

export function initAgentTerminalEngine(maouRoot?: string, projectRoot?: string): boolean {
  const root = maouRoot ?? join(homedir(), ".maou");
  const persist = resolveTerminalPersistPath(projectRoot);
  try {
    if (!inited) {
      initTerminalEngine(join(root, "logs", "terminal-engine"), persist);
      inited = true;
    } else {
      getActiveBackend().setPersistPath(persist);
    }
    return true;
  } catch (e) {
    console.warn(
      "[webui] 终端后端初始化失败:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}

/** 引擎已起来之后，随 AgentHub 切项目改 persist；未 init 则 no-op。 */
export function rebindAgentTerminalPersist(projectRoot?: string): void {
  if (!inited) return;
  try {
    getActiveBackend().setPersistPath(resolveTerminalPersistPath(projectRoot));
  } catch {
    /* ignore */
  }
}

function mapInfo(t: BackendInfo): TerminalInfo {
  return {
    id: t.id,
    agentName: t.agentName,
    command: t.command ?? "",
    description: t.description ?? "",
    state: t.state ?? "",
    exitCode: t.exitCode ?? null,
    cwd: t.cwd ?? "",
    createdAt: t.createdAt ?? "",
    updatedAt: t.updatedAt ?? "",
    kind: t.kind ?? (t.id.startsWith("human_") ? "human" : "agent"),
  };
}

export function listAgentTerminals(agentName?: string): TerminalInfo[] {
  try {
    const raw = agentName ? getActiveBackend().list(agentName) : getActiveBackend().list();
    return (raw ?? []).map(mapInfo);
  } catch {
    return [];
  }
}

export async function getAgentTerminalLogs(
  id: string,
  agentName: string,
  lines = 8000,
): Promise<string> {
  try {
    return await Promise.race([
      getActiveBackend().logs(id, agentName, lines),
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
  await getActiveBackend().write(id, agentName, data);
}

export async function stopAgentTerminal(
  id: string,
  agentName: string,
): Promise<void> {
  await getActiveBackend().stop(id, agentName);
}

export async function resizeAgentTerminal(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  const be = getActiveBackend();
  if (!be.resize) {
    throw new Error("当前终端后端不支持 resize（mini 或旧 .node）");
  }
  await be.resize(id, cols, rows);
}

/**
 * WebSocket：附着到指定 agent 终端。优先 subscribe，否则轮询 logs。
 */
export function attachAgentTerminalSocket(
  ws: WebSocket,
  opts: { id: string; agentName: string; pollMs?: number },
): void {
  const pollMs = opts.pollMs ?? 250;
  let last = "";
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;

  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
  };

  const sendStatus = () => {
    const list = listAgentTerminals(opts.agentName);
    const info = list.find((t) => t.id === opts.id);
    if (!info) return;
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
      info.state === "killed" ||
      info.exitCode != null
    ) {
      send({ type: "exit", code: info.exitCode });
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
        send({ type: "reset", data: full });
        last = full;
      }
      sendStatus();
    } catch (e) {
      send({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  void (async () => {
    const be = getActiveBackend();
    const initial = await getAgentTerminalLogs(opts.id, opts.agentName, 12000);
    last = initial;
    send({
      type: "ready",
      id: opts.id,
      agentName: opts.agentName,
      data: initial,
    });

    if (typeof be.subscribe === "function") {
      unsub = be.subscribe(opts.id, (ev) => {
        if (closed) return;
        if (ev.kind === "data" && ev.data) send({ type: "data", data: ev.data });
        if (ev.kind === "exit") send({ type: "exit", code: ev.exitCode ?? null });
        if (ev.kind === "error") send({ type: "error", message: ev.message });
      });
      timer = setInterval(() => {
        if (!closed) sendStatus();
      }, Math.max(pollMs * 4, 1000));
      return;
    }

    timer = setInterval(() => void tick(), pollMs);
  })();

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string;
        data?: string;
        cols?: number;
        rows?: number;
      };
      if (msg.type === "ping") {
        send({ type: "pong" });
        return;
      }
      if (msg.type === "input" && typeof msg.data === "string") {
        void writeAgentTerminal(opts.id, opts.agentName, msg.data).catch((e) => {
          send({
            type: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        });
      }
      if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        void resizeAgentTerminal(opts.id, msg.cols, msg.rows).catch(() => {});
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
    try {
      unsub?.();
    } catch {
      /* ignore */
    }
    unsub = null;
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
