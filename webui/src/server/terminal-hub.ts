/**
 * TerminalHub —— Web 人开壳，走 Rust openInteractive + subscribe。
 * WS 断开只 detach（不杀进程）；显式 stop 才杀。
 * 无 Rust / 已降级 mini 时 create 返回明确错误。
 */

import type { WebSocket } from "ws";
import {
  resolveConfiguredMode,
  resolveInteractiveShell,
  resolveTerminalBackend,
} from "@little-house-studio/tools";

type Listed = {
  id: string;
  agentName?: string;
  agent_name?: string;
  cwd?: string;
  state?: string;
};

type Engine = {
  isNativeAvailable: boolean;
  hasOpenInteractive?: boolean;
  hasSubscribe?: boolean;
  hasResize?: boolean;
  openInteractive: (opts: {
    agentName: string;
    cwd: string;
    cols?: number;
    rows?: number;
    shell?: string;
  }) => Promise<string>;
  subscribe?: (id: string, onEvent: (ev: { kind: string; data?: string; exitCode?: number | null }) => void) => () => void;
  write: (id: string, agentName: string, data: string) => Promise<void>;
  resize?: (id: string, cols: number, rows: number) => void | Promise<void>;
  stop: (id: string, agentName: string) => Promise<void>;
  logs?: (id: string, agentName: string, lines?: number) => Promise<string>;
  list?: (agentName?: string) => Listed[];
};

export interface HumanSession {
  id: string;
  agentName: string;
  cwd: string;
  unsub?: () => void;
  replay?: string;
}

/** 与 Agent / CLI 同一 TerminalBackend，避免人壳走另一份 Rust 单例。 */
function loadEngineFromBackend(): Engine | null {
  const resolved = resolveTerminalBackend();
  const be = resolved.backend;
  if (resolved.kind !== "full" || resolved.degraded || typeof be.openInteractive !== "function") {
    return null;
  }
  return {
    isNativeAvailable: true,
    hasOpenInteractive: true,
    hasSubscribe: typeof be.subscribe === "function",
    hasResize: typeof be.resize === "function",
    openInteractive: async (opts) => {
      const raw = await be.openInteractive!(opts);
      return typeof raw === "string" ? raw : raw.id;
    },
    subscribe: be.subscribe
      ? (id, onEvent) =>
          be.subscribe!(id, (ev) => {
            onEvent({
              kind: ev.kind,
              data: ev.data,
              exitCode: ev.exitCode ?? null,
            });
          })
      : undefined,
    write: (id, agentName, data) => be.write(id, agentName, data),
    resize: be.resize ? (id, cols, rows) => be.resize!(id, cols, rows) : undefined,
    stop: (id, agentName) => be.stop(id, agentName),
    logs: (id, agentName, lines) => be.logs(id, agentName, lines),
    list: (agentName) => be.list(agentName),
  };
}

export function getHumanShellCapabilities(): {
  humanShell: boolean;
  kind: "full" | "mini";
  degraded: boolean;
  reason?: string;
} {
  const mode = resolveConfiguredMode();
  if (mode === "mini") {
    return {
      humanShell: false,
      kind: "mini",
      degraded: false,
      reason: "当前为 mini 模式，人壳需要 Rust full",
    };
  }
  if (!loadEngineFromBackend()) {
    return {
      humanShell: false,
      kind: "mini",
      degraded: true,
      reason: "人壳需要 Rust terminal-engine .node（full 已降级为 mini）",
    };
  }
  return { humanShell: true, kind: "full", degraded: false };
}

type Meta = { agentName: string; cwd: string; unsubs: Array<() => void> };

export class TerminalHub {
  constructor(private readonly resolveEngine: () => Engine | null = loadEngineFromBackend) {}

  private meta = new Map<string, Meta>();

  private remember(id: string, agentName: string, cwd: string, unsub?: () => void): void {
    const cur = this.meta.get(id);
    if (cur) {
      if (unsub) cur.unsubs.push(unsub);
      cur.agentName = agentName;
      cur.cwd = cwd;
      return;
    }
    this.meta.set(id, { agentName, cwd, unsubs: unsub ? [unsub] : [] });
  }

  private bindStream(
    engine: Engine,
    id: string,
    onData: (data: string) => void,
    onExit: (code: number | null) => void,
  ): (() => void) | undefined {
    if (!engine.hasSubscribe || typeof engine.subscribe !== "function") return undefined;
    return engine.subscribe(id, (ev) => {
      if (ev.kind === "data" && ev.data) onData(ev.data);
      if (ev.kind === "exit") onExit(ev.exitCode ?? null);
    });
  }

  async create(opts: {
    cwd?: string;
    cols?: number;
    rows?: number;
    agentName?: string;
    shell?: string;
    onData: (data: string) => void;
    onExit: (code: number | null) => void;
  }): Promise<HumanSession> {
    const engine = this.resolveEngine();
    if (!engine) {
      throw new Error(
        "人壳需要 Rust terminal-engine（full）。当前无 .node 或已降级 mini。请运行 node scripts/ensure-terminal-engine.mjs",
      );
    }
    const cwd = opts.cwd || process.cwd();
    const cols = Math.max(2, opts.cols ?? 80);
    const rows = Math.max(1, opts.rows ?? 24);
    const agentName = opts.agentName || "webui";
    const shell = opts.shell ?? resolveInteractiveShell();
    const id = await engine.openInteractive({ agentName, cwd, cols, rows, shell });
    const unsub = this.bindStream(engine, id, opts.onData, opts.onExit);
    this.remember(id, agentName, cwd, unsub);
    return { id, agentName, cwd, unsub };
  }

  async attach(
    id: string,
    opts: {
      onData: (data: string) => void;
      onExit: (code: number | null) => void;
      cols?: number;
      rows?: number;
    },
  ): Promise<HumanSession> {
    const engine = this.resolveEngine();
    if (!engine) {
      throw new Error("人壳需要 Rust terminal-engine（full）");
    }
    const listed = typeof engine.list === "function" ? engine.list() : [];
    const info = listed.find((t) => t.id === id);
    const cached = this.meta.get(id);
    const agentName = info?.agentName ?? info?.agent_name ?? cached?.agentName ?? "webui";
    const cwd = info?.cwd ?? cached?.cwd ?? process.cwd();
    if (!info && !cached) {
      throw new Error(`终端 ${id} 不存在`);
    }
    let replay = "";
    if (typeof engine.logs === "function") {
      try {
        replay = (await engine.logs(id, agentName, 8000)) || "";
      } catch {
        /* ignore */
      }
    }
    if (opts.cols && opts.rows && engine.hasResize && typeof engine.resize === "function") {
      try {
        await engine.resize(id, Math.max(2, opts.cols), Math.max(1, opts.rows));
      } catch {
        /* ignore */
      }
    }
    const unsub = this.bindStream(engine, id, opts.onData, opts.onExit);
    this.remember(id, agentName, cwd, unsub);
    return { id, agentName, cwd, unsub, replay };
  }

  async write(id: string, data: string): Promise<boolean> {
    const s = this.meta.get(id);
    const engine = this.resolveEngine();
    if (!s || !engine) return false;
    try {
      await engine.write(id, s.agentName, data);
      return true;
    } catch {
      return false;
    }
  }

  async resize(id: string, cols: number, rows: number): Promise<boolean> {
    const s = this.meta.get(id);
    const engine = this.resolveEngine();
    if (!s || !engine?.hasResize || typeof engine.resize !== "function") return false;
    try {
      await engine.resize(id, Math.max(2, cols), Math.max(1, rows));
      return true;
    } catch {
      return false;
    }
  }

  /** 只取消本端订阅，不杀进程 */
  detach(id: string, unsub?: () => void): void {
    const s = this.meta.get(id);
    if (!s) return;
    if (unsub) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
      s.unsubs = s.unsubs.filter((u) => u !== unsub);
      return;
    }
    for (const u of s.unsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    s.unsubs = [];
  }

  /** 显式停止：杀进程 */
  stop(id: string): void {
    const s = this.meta.get(id);
    this.detach(id);
    const engine = this.resolveEngine();
    if (engine && s) {
      void engine.stop(id, s.agentName).catch(() => {});
    }
    this.meta.delete(id);
  }

  /** @deprecated 用 stop；保留给旧测试/调用 */
  close(id: string): void {
    this.stop(id);
  }

  closeAll(): void {
    for (const id of [...this.meta.keys()]) this.stop(id);
  }

  isTracked(id: string): boolean {
    return this.meta.has(id);
  }
}

/** 绑定一条 WebSocket 到人壳生命周期 */
export function attachTerminalSocket(
  hub: TerminalHub,
  ws: WebSocket,
  cwd?: string,
  agentName?: string,
): void {
  let termId: string | null = null;
  let attachedUnsub: (() => void) | undefined;

  const send = (msg: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        /* ignore */
      }
    }
  };

  const wire = (session: HumanSession) => {
    termId = session.id;
    attachedUnsub = session.unsub;
    send({
      type: "ready",
      id: session.id,
      cwd: session.cwd,
      kind: "human",
      agentName: session.agentName,
      data: session.replay || undefined,
    });
  };

  const onData = (data: string) => send({ type: "data", data });
  const onExit = (code: number | null) => {
    send({ type: "exit", code });
    termId = null;
    attachedUnsub = undefined;
  };

  ws.on("message", (raw) => {
    void (async () => {
      try {
        let msg: {
          type?: string;
          data?: string;
          cols?: number;
          rows?: number;
          cwd?: string;
          id?: string;
        };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (msg.type === "ping") {
          send({ type: "pong" });
          return;
        }

        if (msg.type === "create") {
          if (termId) hub.detach(termId, attachedUnsub);
          attachedUnsub = undefined;
          try {
            const session = await hub.create({
              cwd: msg.cwd || cwd,
              cols: msg.cols,
              rows: msg.rows,
              agentName,
              onData,
              onExit,
            });
            wire(session);
          } catch (e) {
            send({
              type: "error",
              message: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        if (msg.type === "attach" && typeof msg.id === "string") {
          if (termId) hub.detach(termId, attachedUnsub);
          attachedUnsub = undefined;
          try {
            const session = await hub.attach(msg.id, {
              onData,
              onExit,
              cols: msg.cols,
              rows: msg.rows,
            });
            wire(session);
          } catch (e) {
            send({
              type: "error",
              message: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }

        if (msg.type === "input" && termId && typeof msg.data === "string") {
          await hub.write(termId, msg.data);
          return;
        }

        if (
          msg.type === "resize" &&
          termId &&
          typeof msg.cols === "number" &&
          typeof msg.rows === "number"
        ) {
          await hub.resize(termId, msg.cols, msg.rows);
          return;
        }

        if ((msg.type === "stop" || msg.type === "close") && termId) {
          hub.stop(termId);
          termId = null;
          attachedUnsub = undefined;
        }
      } catch (e) {
        send({
          type: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  });

  const dropView = () => {
    if (termId) hub.detach(termId, attachedUnsub);
    termId = null;
    attachedUnsub = undefined;
  };

  ws.on("close", dropView);
  ws.on("error", dropView);
}
