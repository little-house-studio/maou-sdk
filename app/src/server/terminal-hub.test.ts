import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getHumanShellCapabilities, TerminalHub } from "./terminal-hub.js";

describe("human shell capabilities", () => {
  it("MAOU_TERMINAL=mini 时人壳不可用并给出原因", () => {
    const prev = process.env.MAOU_TERMINAL;
    process.env.MAOU_TERMINAL = "mini";
    try {
      const c = getHumanShellCapabilities();
      assert.equal(c.humanShell, false);
      assert.equal(c.kind, "mini");
      assert.match(c.reason ?? "", /mini|Rust|full/i);
    } finally {
      if (prev === undefined) delete process.env.MAOU_TERMINAL;
      else process.env.MAOU_TERMINAL = prev;
    }
  });
});

describe("TerminalHub detach ≠ stop", () => {
  it("detach 只退订，stop 才杀进程", async () => {
    const stopped: string[] = [];
    let unsubCalls = 0;
    const engine = {
      isNativeAvailable: true,
      hasOpenInteractive: true,
      hasSubscribe: true,
      hasResize: true,
      openInteractive: async () => "human_1",
      subscribe: () => () => {
        unsubCalls += 1;
      },
      write: async () => {},
      resize: () => {},
      stop: async (id: string) => {
        stopped.push(id);
      },
      logs: async () => "replay-line\n",
      list: () => [{ id: "human_1", agentName: "app", cwd: "/tmp", state: "running" }],
    };
    const hub = new TerminalHub(() => engine);
    const session = await hub.create({
      cwd: "/tmp",
      agentName: "coding",
      onData: () => {},
      onExit: () => {},
    });
    assert.equal(session.id, "human_1");
    assert.equal(session.agentName, "coding");
    hub.detach(session.id, session.unsub);
    assert.equal(stopped.length, 0);
    assert.equal(unsubCalls, 1);
    assert.equal(hub.isTracked(session.id), true);

    const attached = await hub.attach(session.id, {
      onData: () => {},
      onExit: () => {},
    });
    assert.match(attached.replay ?? "", /replay-line/);

    hub.stop(session.id);
    assert.deepEqual(stopped, ["human_1"]);
    assert.equal(hub.isTracked(session.id), false);
  });
});
