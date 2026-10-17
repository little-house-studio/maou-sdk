import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { installDesktopTransport } from "./desktop-transport.ts";
import { createTauriBridge, isTauriShell, type TauriIpc } from "./tauri-bridge.ts";

type Call = { cmd: string; args?: Record<string, unknown> };

function fakeIpc(handler: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const calls: Call[] = [];
  const channels: Array<(msg: unknown) => void> = [];
  const ipc: TauriIpc = {
    invoke: <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return handler(cmd, args) as Promise<T>;
    },
    channel: (onMessage) => {
      channels.push(onMessage as (msg: unknown) => void);
      return { channel: channels.length - 1 };
    },
  };
  return { ipc, calls, channels };
}

const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("tauri bridge", () => {
  it("detects the Tauri shell by its internals", () => {
    assert.equal(isTauriShell({} as Window), false);
    assert.equal(isTauriShell({ __TAURI_INTERNALS__: {} } as unknown as Window), true);
  });

  it("streams http chunks, then end, over one channel", async () => {
    const head = { status: 200, statusText: "OK", headers: {} };
    const { ipc, calls, channels } = fakeIpc(async () => head);
    const bridge = createTauriBridge(ipc, "darwin");
    assert.equal(bridge.platform, "darwin");

    const got: string[] = [];
    let ended = false;
    bridge.onHttpChunk("r1", (c) => got.push(new TextDecoder().decode(c)));
    bridge.onHttpEnd("r1", () => {
      ended = true;
    });
    const req = { id: "r1", path: "/api/meta", method: "GET" };
    assert.deepEqual(await bridge.httpStart(req), head);
    assert.equal(calls[0]!.cmd, "hub_http_start");
    assert.deepEqual(calls[0]!.args!.req, req);
    assert.deepEqual(calls[0]!.args!.onEvent, { channel: 0 });

    channels[0]!(bytes("he"));
    channels[0]!(new Uint8Array(bytes("llo")));
    channels[0]!({ t: "end" });
    assert.deepEqual(got, ["he", "llo"]);
    assert.equal(ended, true);
  });

  it("surfaces stream errors and rejected starts", async () => {
    const { ipc, channels } = fakeIpc(async (cmd) => {
      if (cmd === "hub_http_start") throw "hub 已停止";
      return undefined;
    });
    const bridge = createTauriBridge(ipc, "linux");
    const errors: string[] = [];
    bridge.onHttpError("r2", (m) => errors.push(m));
    await assert.rejects(bridge.httpStart({ id: "r2", path: "/api/x", method: "GET" }), /hub 已停止/);
    // 失败后该 id 的监听已清掉
    channels[0]!({ t: "error", message: "late" });
    assert.deepEqual(errors, []);
  });

  it("maps ws and native calls to shell commands", async () => {
    const { ipc, calls, channels } = fakeIpc(async (cmd) => {
      if (cmd === "pick_folder") return { path: "/work" };
      return { ok: true };
    });
    const bridge = createTauriBridge(ipc, "win32");
    const msgs: string[] = [];
    let closed = 0;
    bridge.onWsMessage("w1", (d) => msgs.push(d));
    bridge.onWsClose!("w1", () => closed++);

    bridge.wsOpen("w1", "ws://localhost/ws/terminal");
    bridge.wsSend("w1", "{\"type\":\"input\"}");
    bridge.wsClose("w1");
    bridge.httpAbort("r9");
    channels[0]!({ t: "msg", data: "hi" });
    channels[0]!({ t: "close" });
    assert.deepEqual(msgs, ["hi"]);
    assert.equal(closed, 1);

    assert.deepEqual(await bridge.pickFolder!(), { path: "/work" });
    await bridge.revealInFolder!("/work/a.md");
    await bridge.openPath!("/work/a.md");
    assert.deepEqual(
      calls.map((c) => [c.cmd, c.args ? Object.keys(c.args).sort().join(",") : ""]),
      [
        ["hub_ws_open", "id,onEvent,url"],
        ["hub_ws_send", "data,id"],
        ["hub_ws_close", "id"],
        ["hub_http_abort", "id"],
        ["pick_folder", ""],
        ["reveal_in_folder", "path"],
        ["open_path", "path"],
      ],
    );
  });

  it("reports a failed ws open as a close", async () => {
    const { ipc } = fakeIpc(async () => {
      throw new Error("不支持的 WS 地址");
    });
    const bridge = createTauriBridge(ipc, "darwin");
    let closed = false;
    bridge.onWsClose!("w2", () => {
      closed = true;
    });
    const origError = console.error;
    console.error = () => {};
    try {
      bridge.wsOpen("w2", "ws://x/ws/other");
      await tick();
    } finally {
      console.error = origError;
    }
    assert.equal(closed, true);
  });
});

describe("desktop transport over the tauri bridge", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, window: g.window };
  afterEach(() => {
    globalThis.fetch = saved.fetch;
    globalThis.WebSocket = saved.WebSocket;
    g.window = saved.window;
  });

  it("fetch keeps chunks that arrive before the head", async () => {
    g.window = globalThis;
    let resolveHead!: (h: unknown) => void;
    const { ipc, channels } = fakeIpc((cmd) =>
      cmd === "hub_http_start" ? new Promise((r) => (resolveHead = r)) : Promise.resolve(),
    );
    assert.equal(installDesktopTransport(createTauriBridge(ipc, "darwin")), true);

    const pending = fetch("/api/meta?x=1", { method: "POST", body: "{}" });
    await tick();
    channels[0]!(bytes("hel"));
    channels[0]!(bytes("lo"));
    channels[0]!({ t: "end" });
    resolveHead({ status: 201, statusText: "Created", headers: { "content-type": "text/plain" } });
    const res = await pending;
    assert.equal(res.status, 201);
    assert.equal(res.headers.get("content-type"), "text/plain");
    assert.equal(await res.text(), "hello");
  });

  it("only hub /ws/* goes through IPC and hub-side close reaches onclose", async () => {
    g.window = globalThis;
    const OrigWS = globalThis.WebSocket;
    const { ipc, calls, channels } = fakeIpc(async () => undefined);
    installDesktopTransport(createTauriBridge(ipc, "darwin"));

    const ws = new WebSocket("ws://localhost/ws/terminal");
    const seen: string[] = [];
    let closed = false;
    ws.onmessage = (ev) => seen.push(String(ev.data));
    ws.onclose = () => {
      closed = true;
    };
    await tick();
    assert.equal(ws.readyState, WebSocket.OPEN);
    assert.equal(calls[0]!.cmd, "hub_ws_open");
    channels[0]!({ t: "msg", data: "{\"type\":\"output\"}" });
    channels[0]!({ t: "close" });
    assert.deepEqual(seen, ["{\"type\":\"output\"}"]);
    assert.equal(closed, true);
    assert.equal(ws.readyState, WebSocket.CLOSED);

    if (typeof OrigWS === "function") {
      const native = new WebSocket("ws://127.0.0.1:9/elsewhere");
      assert.ok(native instanceof OrigWS);
      native.onerror = () => {};
      native.close();
    }
  });
});
