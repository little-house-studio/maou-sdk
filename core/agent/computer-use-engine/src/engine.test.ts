import { afterEach, describe, expect, it } from "vitest";
import {
  MISSING_HELPER,
  UNSUPPORTED_PLATFORM,
  act,
  desktopOwnerFrom,
  isAvailable,
  rememberSnapshot,
  resetCursorsForTest,
  resetHelperPathCache,
  resetSnapshotsForTest,
  run,
  setHelperRunnerForTest,
  snapshot,
} from "./index.js";
import type { HelperEnvelope, HelperRequest } from "./types.js";

afterEach(() => {
  setHelperRunnerForTest(undefined);
  resetSnapshotsForTest();
  resetHelperPathCache();
  resetCursorsForTest();
});

function axSnap(over: Partial<HelperEnvelope> = {}): HelperEnvelope {
  return {
    ok: true,
    op: "snapshot",
    route: "ax",
    snapshotId: "cu1_testsnapshot000000000000000001",
    app: "Finder",
    pid: 42,
    elements: [
      {
        ref: 1,
        role: "AXButton",
        title: "New Folder",
        enabled: true,
        actions: ["AXPress"],
        frame: { x: 10, y: 20, w: 80, h: 24 },
      },
    ],
    permissions: { ax: true, screen: true, input: true },
    ...over,
  };
}

describe("run with injected helper", () => {
  it("snapshots then clicks by [N]", async () => {
    const calls: HelperRequest[] = [];
    setHelperRunnerForTest(async (req) => {
      calls.push(req);
      if (req.op === "snapshot") return axSnap();
      if (req.op === "act") {
        return {
          ...axSnap(),
          op: "act",
          message: "clicked via AXPress",
        };
      }
      return { ok: false, error: `unexpected ${req.op}` };
    });

    const seen = await snapshot({ app: "Finder" }, { helperPath: "/dev/null", runner: undefined });
    expect(seen.ok).toBe(true);
    expect(seen.message).toMatch(/\[1\] AXButton "New Folder"/);
    expect(seen.payload.snapshotId).toBe("cu1_testsnapshot000000000000000001");

    const clicked = await run(
      "click",
      { target: "[1]", snapshot: "cu1_testsnapshot000000000000000001" },
      { helperPath: "/dev/null" },
    );
    expect(clicked.ok).toBe(true);
    const actReq = calls.find((c) => c.op === "act");
    expect(actReq?.ref).toBe(1);
    expect(actReq?.locator?.title).toBe("New Folder");
    expect(actReq?.kind).toBe("click");
  });

  it("help does not need a helper", async () => {
    const r = await run("help");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/list/);
  });

  it("list returns the catalog without a helper", async () => {
    const r = await run("list");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/screenshot/);
    expect(Array.isArray(r.payload.actions)).toBe(true);
  });

  it("call name=screenshot routes to observe", async () => {
    let seen: HelperRequest | undefined;
    setHelperRunnerForTest(async (req) => {
      seen = req;
      return { ok: true, op: "observe", route: "pixels", message: "screenshot", imageBase64: "aaa" };
    });
    const owner = desktopOwnerFrom("coding", "s1");
    const r = await run("call", { name: "screenshot" }, { helperPath: "/dev/null", owner });
    expect(r.ok).toBe(true);
    expect(seen?.op).toBe("observe");
    expect(seen?.kind).toBe("screenshot");
    expect(seen?.restoreMouse).toBe(true);
    expect(seen?.cursorLabel).toBe("coding");
  });

  it("serializes desktop actions on one lock", async () => {
    let finishedFirst = false;
    let calls = 0;
    setHelperRunnerForTest(async () => {
      const n = calls++;
      if (n === 0) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        finishedFirst = true;
      } else {
        expect(finishedFirst).toBe(true);
      }
      return { ok: true, op: "observe", route: "pixels", message: "screenshot", imageBase64: "x" };
    });
    await Promise.all([
      run("screenshot", {}, { helperPath: "/dev/null" }),
      run("screenshot", {}, { helperPath: "/dev/null" }),
    ]);
    expect(calls).toBe(2);
  });

  it("unknown action names the miss", async () => {
    const r = await run("explode", {}, { helperPath: "/dev/null", runner: async () => ({ ok: true }) });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/未知操作/);
  });

  it("routes activate to the helper", async () => {
    const calls: HelperRequest[] = [];
    setHelperRunnerForTest(async (req) => {
      calls.push(req);
      return { ok: true, op: "activate", message: "activated 访达", app: "访达", pid: 11 };
    });
    const r = await run("activate", { app: "访达" }, { helperPath: "/dev/null" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/activated/);
    expect(calls[0]?.op).toBe("activate");
    expect(calls[0]?.app).toBe("访达");
  });

  it("routes set-value through act", async () => {
    rememberSnapshot({
      route: "ax",
      snapshotId: "cu1_setvalue",
      app: "TextEdit",
      pid: 8,
      elements: [{ ref: 1, role: "AXTextArea", title: "text", enabled: true }],
      permissions: { ax: true, screen: false, input: true },
    });
    let seen: HelperRequest | undefined;
    setHelperRunnerForTest(async (req) => {
      seen = req;
      return { ok: true, op: "act", route: "ax", message: "AXSetValue" };
    });
    const r = await run(
      "set-value",
      { target: "[1]", snapshot: "cu1_setvalue", text: "hello", app: "TextEdit" },
      { helperPath: "/dev/null" },
    );
    expect(r.ok).toBe(true);
    expect(seen?.op).toBe("act");
    expect(seen?.kind).toBe("set-value");
    expect(seen?.text).toBe("hello");
  });
});

describe("availability", () => {
  it("reports a helper flag without spawning", () => {
    resetHelperPathCache();
    const a = isAvailable({ env: { MAOU_COMPUTER_USE_HELPER: "" } });
    expect(a.platform).toBeTruthy();
    expect(typeof a.helper).toBe("boolean");
  });
});

describe("act locators", () => {
  it("sends cached locator so a one-shot helper can re-find the node", async () => {
    rememberSnapshot({
      route: "ax",
      snapshotId: "cu1_cached",
      app: "TextEdit",
      pid: 9,
      elements: [{ ref: 2, role: "AXTextField", title: "Name", enabled: true }],
      permissions: { ax: true, screen: false, input: true },
    });
    let seen: HelperRequest | undefined;
    setHelperRunnerForTest(async (req) => {
      seen = req;
      return { ok: true, op: "act", route: "ax", message: "typed", elements: [] };
    });
    const r = await act(
      { kind: "type", target: "[2]", snapshotId: "cu1_cached", text: "hello" },
      { helperPath: "/dev/null" },
    );
    expect(r.ok).toBe(true);
    expect(seen?.locator).toEqual({ ref: 2, role: "AXTextField", title: "Name" });
    expect(seen?.app).toBe("TextEdit");
    expect(seen?.text).toBe("hello");
  });
});

describe("auto fallback", () => {
  it("keeps pixels route and reason from the helper", async () => {
    setHelperRunnerForTest(async () => ({
      ok: true,
      op: "snapshot",
      route: "pixels",
      snapshotId: "cu1_pixels",
      fallbackReason: "控件树为空或不可用，降级到截图/坐标。",
      elements: [],
      imageBase64: "aaa",
      permissions: { ax: true, screen: true, input: true },
    }));
    const r = await run("snapshot", { app: "Finder" }, { mode: "auto", helperPath: "/dev/null" });
    expect(r.ok).toBe(true);
    expect(r.payload.route).toBe("pixels");
    expect(r.message).toMatch(/降级/);
    expect(r.imageBase64).toBe("aaa");
  });
});

describe("missing helper copy", () => {
  it("keeps the reserved platform / helper sentences", () => {
    expect(UNSUPPORTED_PLATFORM).toMatch(/macOS/);
    expect(MISSING_HELPER).toMatch(/computer-use-helper/);
  });
});
