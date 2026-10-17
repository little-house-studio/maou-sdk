/**
 * Tauri 壳上的 `window.maouApp`：把 DesktopAppBridge 映射到 src-tauri 的命令。
 * HTTP 响应体 / WS 消息经 Channel 推回；块是 ArrayBuffer，控制帧是 `{ t }` 对象。
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import type { DesktopAppBridge, DesktopHttpHead } from "./desktop-transport";

type DesktopPlatform = NonNullable<DesktopAppBridge["platform"]>;

declare global {
  interface Window {
    /** src-tauri 在页面脚本前注入（platform.rs init_script）。 */
    __MAOU_DESKTOP__?: { kind: "desktop"; shell: "tauri"; platform?: DesktopPlatform };
    __TAURI_INTERNALS__?: unknown;
  }
}

type HttpMsg = ArrayBuffer | ArrayBufferView | { t: "end" } | { t: "error"; message: string };
type WsMsg = { t: "msg"; data: string } | { t: "close" };

export type TauriIpc = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** 新建 Channel 并挂上回调；返回值原样放进 invoke 参数。 */
  channel: <T>(onMessage: (msg: T) => void) => unknown;
};

const tauriIpc: TauriIpc = {
  invoke: (cmd, args) => invoke(cmd, args),
  channel: <T,>(onMessage: (msg: T) => void) => {
    const ch = new Channel<T>();
    ch.onmessage = onMessage;
    return ch;
  },
};

export function isTauriShell(w: Window = window): boolean {
  return w.__TAURI_INTERNALS__ != null;
}

function listeners<A extends unknown[]>() {
  const byId = new Map<string, Set<(...args: A) => void>>();
  return {
    on(id: string, cb: (...args: A) => void): () => void {
      let set = byId.get(id);
      if (!set) byId.set(id, (set = new Set()));
      set.add(cb);
      return () => {
        set.delete(cb);
        if (set.size === 0 && byId.get(id) === set) byId.delete(id);
      };
    },
    emit(id: string, ...args: A): void {
      for (const cb of [...(byId.get(id) ?? [])]) cb(...args);
    },
    drop(id: string): void {
      byId.delete(id);
    },
  };
}

function chunkBytes(msg: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  return new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
}

export function createTauriBridge(
  ipc: TauriIpc = tauriIpc,
  platform: DesktopPlatform | undefined = typeof window === "undefined"
    ? undefined
    : window.__MAOU_DESKTOP__?.platform,
): DesktopAppBridge {
  const chunk = listeners<[Uint8Array]>();
  const end = listeners<[]>();
  const fail = listeners<[string]>();
  const wsMsg = listeners<[string]>();
  const wsClose = listeners<[]>();
  const quiet = (p: Promise<unknown>) => void p.catch(() => {});

  return {
    kind: "desktop",
    platform,
    httpStart(req) {
      const onEvent = ipc.channel<HttpMsg>((msg) => {
        if (msg instanceof ArrayBuffer || ArrayBuffer.isView(msg)) {
          chunk.emit(req.id, chunkBytes(msg));
        } else if (msg.t === "end") {
          end.emit(req.id);
        } else if (msg.t === "error") {
          fail.emit(req.id, msg.message);
        }
      });
      return ipc.invoke<DesktopHttpHead>("hub_http_start", { req, onEvent }).catch((err) => {
        chunk.drop(req.id);
        end.drop(req.id);
        fail.drop(req.id);
        throw err instanceof Error ? err : new Error(String(err));
      });
    },
    httpAbort: (id) => quiet(ipc.invoke("hub_http_abort", { id })),
    onHttpChunk: chunk.on,
    onHttpEnd: end.on,
    onHttpError: fail.on,
    wsOpen(id, url) {
      const onEvent = ipc.channel<WsMsg>((msg) => {
        if (msg.t === "msg") wsMsg.emit(id, msg.data);
        else wsClose.emit(id);
      });
      ipc.invoke("hub_ws_open", { id, url, onEvent }).catch((err) => {
        console.error("[maou-app] ws open failed", err);
        wsClose.emit(id);
      });
    },
    wsSend: (id, data) => quiet(ipc.invoke("hub_ws_send", { id, data })),
    wsClose: (id) => quiet(ipc.invoke("hub_ws_close", { id })),
    onWsMessage: wsMsg.on,
    onWsClose: wsClose.on,
    pickFolder: () => ipc.invoke("pick_folder"),
    revealInFolder: (path) => ipc.invoke("reveal_in_folder", { path }),
    openPath: (path) => ipc.invoke("open_path", { path }),
  };
}
