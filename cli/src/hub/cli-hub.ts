/**
 * CLI 多窗口同进程 Hub。
 *
 * 产品语义：多个 `maou` 窗口共享同一个 Node 进程的 Runtime / Store，
 * 而不是各自起一套 agent 状态。
 *
 * 机制：
 * - 首个进程成为 hub：写 ~/.maou/run/cli-hub.json，监听 TCP 127.0.0.1 端口
 * - 后续进程连接 hub，请求 open_window → hub 再 spawn 一个 ratatui 子进程
 * - 后续进程在收到 accepted 后退出（TUI 由 hub 托管，绑定到请求方的 TTY 较难）
 *
 * 终端限制：第二个终端的 TTY 无法直接交给已有进程。
 * 因此采用「hub 托管多 TUI」+ 通过环境变量 MAOU_HUB_ATTACH 在**同一 TTY** 上
 * 由 attach 客户端本地 spawn TUI，但状态/输入经 socket 与 hub 同步。
 *
 * 简化落地（可用）：
 * 1. Hub 广播 presence + 当前 chrome 摘要到所有 attach 客户端
 * 2. Attach 客户端本地仍跑完整 runAgentWithRatatui，但共享 presence 文件
 * 3. Hub 记录 window 列表；open_window 时若 product 相同则返回 attach_ok，
 *    客户端以「从窗口」模式启动（共享 presence，不抢 exclusive lock）
 *
 * 真正「一个 Runtime 多个 TUI」需要把 launch 改成 fan-out；本文件提供
 * fan-out 骨架 + 默认可用的 shared-presence 多窗口。
 */

import {
  createServer,
  connect,
  type Server,
  type Socket,
} from "node:net";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface HubMeta {
  version: 1;
  pid: number;
  host: string;
  port: number;
  product: string;
  startedAt: string;
}

export type HubRole = "hub" | "window";

function runDir(): string {
  const root = process.env.MAOU_HOME?.trim() || join(homedir(), ".maou");
  return join(root, "run");
}

export function hubMetaPath(): string {
  return join(runDir(), "cli-hub.json");
}

function readMeta(): HubMeta | null {
  try {
    const p = hubMetaPath();
    if (!existsSync(p)) return null;
    const m = JSON.parse(readFileSync(p, "utf-8")) as HubMeta;
    if (!m?.port || !m?.pid) return null;
    // 进程是否还在
    try {
      process.kill(m.pid, 0);
    } catch {
      try { unlinkSync(p); } catch { /* ignore */ }
      return null;
    }
    return m;
  } catch {
    return null;
  }
}

function writeMeta(meta: HubMeta): void {
  mkdirSync(runDir(), { recursive: true });
  writeFileSync(hubMetaPath(), JSON.stringify(meta, null, 2), "utf-8");
}

function clearMeta(): void {
  try { unlinkSync(hubMetaPath()); } catch { /* ignore */ }
}

let server: Server | null = null;
const clients = new Set<Socket>();
let windowCount = 1;

/**
 * 尝试成为 hub 或探测已有 hub。
 * @returns hub = 本进程做主机；window = 应作为附加窗口；solo = 无多窗口
 */
/**
 * 默认 solo：不启 hub（避免信号/生命周期干扰 TUI 导致 SIGKILL）。
 * 显式 MAOU_CLI_HUB=1 才启用多窗口 hub。
 */
export async function resolveHubRole(
  product: string,
): Promise<{ role: HubRole | "solo"; meta?: HubMeta }> {
  if (process.env.MAOU_CLI_SOLO === "1") {
    return { role: "solo" };
  }
  // 默认关闭 hub；需显式开启
  if (process.env.MAOU_CLI_HUB !== "1") {
    return { role: "solo" };
  }
  const existing = readMeta();
  if (existing) {
    // 同产品才附加；不同产品独立起
    if (existing.product === product || existing.product === "*" || product === "*") {
      const ok = await pingHub(existing);
      if (ok) return { role: "window", meta: existing };
    }
  }
  return { role: "hub" };
}

function pingHub(meta: HubMeta): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: meta.host, port: meta.port }, () => {
      sock.write(JSON.stringify({ type: "ping" }) + "\n");
    });
    const t = setTimeout(() => {
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(false);
    }, 400);
    sock.on("data", (buf) => {
      clearTimeout(t);
      const line = buf.toString("utf-8").split("\n")[0] ?? "";
      try {
        const msg = JSON.parse(line) as { type?: string };
        resolve(msg.type === "pong");
      } catch {
        resolve(false);
      }
      try { sock.end(); } catch { /* ignore */ }
    });
    sock.on("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

/** 成为 hub：监听端口并写 meta */
export function startCliHub(product: string): Promise<HubMeta> {
  return new Promise((resolve, reject) => {
    const host = "127.0.0.1";
    const srv = createServer((sock) => {
      clients.add(sock);
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf-8");
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          handleClientLine(sock, line);
        }
      });
      sock.on("close", () => clients.delete(sock));
      sock.on("error", () => clients.delete(sock));
    });
    server = srv;
    srv.listen(0, host, () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("hub listen failed"));
        return;
      }
      const meta: HubMeta = {
        version: 1,
        pid: process.pid,
        host,
        port: addr.port,
        product,
        startedAt: new Date().toISOString(),
      };
      writeMeta(meta);
      resolve(meta);
    });
    srv.on("error", reject);

    // 只在进程真正退出时清 meta；不要抢注册 SIGINT/SIGTERM
    // （会与 useExitGuard / ratatui 的信号处理竞态，子进程易被级联 SIGKILL）
    const cleanup = () => {
      try { srv.close(); } catch { /* ignore */ }
      clearMeta();
    };
    process.once("exit", cleanup);
  });
}

function handleClientLine(sock: Socket, line: string): void {
  if (!line.trim()) return;
  let msg: { type?: string; product?: string };
  try {
    msg = JSON.parse(line) as { type?: string; product?: string };
  } catch {
    return;
  }
  if (msg.type === "ping") {
    sock.write(JSON.stringify({ type: "pong", windows: windowCount }) + "\n");
    return;
  }
  if (msg.type === "register_window") {
    windowCount += 1;
    sock.write(
      JSON.stringify({
        type: "accepted",
        windowId: `w${windowCount}`,
        windows: windowCount,
        shared: true,
      }) + "\n",
    );
    broadcast({ type: "windows_changed", windows: windowCount });
    return;
  }
  if (msg.type === "unregister_window") {
    windowCount = Math.max(1, windowCount - 1);
    broadcast({ type: "windows_changed", windows: windowCount });
    return;
  }
}

function broadcast(msg: Record<string, unknown>): void {
  const line = JSON.stringify(msg) + "\n";
  for (const c of clients) {
    try { c.write(line); } catch { /* ignore */ }
  }
}

/** 附加窗口：向 hub 注册 */
export function registerAsWindow(meta: HubMeta): Promise<{ windowId: string; windows: number }> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host: meta.host, port: meta.port }, () => {
      sock.write(JSON.stringify({ type: "register_window" }) + "\n");
    });
    const t = setTimeout(() => {
      try { sock.destroy(); } catch { /* ignore */ }
      reject(new Error("hub register timeout"));
    }, 1500);
    sock.on("data", (buf) => {
      clearTimeout(t);
      const line = buf.toString("utf-8").split("\n")[0] ?? "";
      try {
        const msg = JSON.parse(line) as {
          type?: string;
          windowId?: string;
          windows?: number;
        };
        if (msg.type === "accepted" && msg.windowId) {
          resolve({ windowId: msg.windowId, windows: msg.windows ?? 1 });
          // 保持连接直到进程退出（通知 hub 窗口存活）
          const unreg = () => {
            try {
              sock.write(JSON.stringify({ type: "unregister_window" }) + "\n");
              sock.end();
            } catch { /* ignore */ }
          };
          process.once("exit", unreg);
          process.once("SIGINT", unreg);
          process.once("SIGTERM", unreg);
          return;
        }
      } catch {
        /* ignore */
      }
      reject(new Error("hub register failed"));
    });
    sock.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export function getHubWindowCount(): number {
  return windowCount;
}
