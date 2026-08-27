import { ipcMain } from "electron";
import type { WebSocket } from "ws";
import type { AppServer } from "../server/create-server.js";

type WsLike = WebSocket & {
  readyState: number;
  OPEN: number;
  send: (data: string) => void;
  close: () => void;
  on: (ev: string, fn: (...args: unknown[]) => void) => WsLike;
};

function parseWsPath(raw: string): { pathname: string; search: string } {
  try {
    const u = new URL(raw, "http://maou.local");
    return { pathname: u.pathname, search: u.search };
  } catch {
    const q = raw.indexOf("?");
    return {
      pathname: q >= 0 ? raw.slice(0, q) : raw,
      search: q >= 0 ? raw.slice(q) : "",
    };
  }
}

function createIpcSocket(
  send: (payload: string) => void,
): { ws: WsLike; push: (data: string) => void; hangup: () => void } {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const emit = (ev: string, ...args: unknown[]) => {
    for (const fn of listeners.get(ev) ?? []) fn(...args);
  };
  let readyState = 1;
  const ws = {
    OPEN: 1,
    get readyState() {
      return readyState;
    },
    send(data: string) {
      send(String(data));
    },
    close() {
      if (readyState === 3) return;
      readyState = 3;
      emit("close");
    },
    on(ev: string, fn: (...args: unknown[]) => void) {
      const list = listeners.get(ev) ?? [];
      list.push(fn);
      listeners.set(ev, list);
      return ws;
    },
  } as WsLike;
  return {
    ws,
    push: (data: string) => emit("message", data),
    hangup: () => {
      if (readyState === 3) return;
      readyState = 3;
      emit("close");
    },
  };
}

export function bindAppWsIpc(server: AppServer): () => void {
  const sockets = new Map<
    string,
    { push: (data: string) => void; hangup: () => void }
  >();

  const onOpen = (
    event: Electron.IpcMainEvent,
    id: string,
    url: string,
  ) => {
    const wc = event.sender;
    const { pathname, search } = parseWsPath(url);
    const shim = createIpcSocket((payload) => {
      if (!wc.isDestroyed()) wc.send(`app:ws-msg:${id}`, payload);
    });
    sockets.set(id, shim);
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    if (pathname === "/ws/agent-terminal") {
      const termId = params.get("id") || "";
      const agent = params.get("agent") || "coding";
      server.attachAgentTerminal(shim.ws, { id: termId, agentName: agent });
      return;
    }
    if (pathname === "/ws/terminal") {
      server.attachHumanTerminal(shim.ws);
    }
  };

  const onSend = (_e: Electron.IpcMainEvent, id: string, data: string) => {
    sockets.get(id)?.push(data);
  };
  const onClose = (_e: Electron.IpcMainEvent, id: string) => {
    sockets.get(id)?.hangup();
    sockets.delete(id);
  };

  ipcMain.on("app:ws-open", onOpen);
  ipcMain.on("app:ws-send", onSend);
  ipcMain.on("app:ws-close", onClose);

  return () => {
    ipcMain.removeListener("app:ws-open", onOpen);
    ipcMain.removeListener("app:ws-send", onSend);
    ipcMain.removeListener("app:ws-close", onClose);
    for (const s of sockets.values()) s.hangup();
    sockets.clear();
  };
}
