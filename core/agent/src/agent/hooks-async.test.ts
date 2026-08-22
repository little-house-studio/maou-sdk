import { describe, expect, it } from "vitest";
import { Hooks, type HookUi } from "./hooks.js";

describe("Pi-style async hooks", () => {
  it("blocks tool_call with { block, reason }", async () => {
    const hooks = new Hooks();
    hooks.on("tool_call", (event) => {
      if (event.toolName === "bash") {
        return { block: true, reason: "dangerous" };
      }
    });
    const ok = await hooks.preToolUse({
      id: "1",
      name: "use_terminal",
      parameters: { command: "rm -rf /" },
    } as never);
    expect(ok).toBe(false);
    expect(hooks.lastBlockReason).toBe("dangerous");
  });

  it("awaits ui.confirm before allowing", async () => {
    const hooks = new Hooks();
    const ui: HookUi = {
      async confirm() {
        return true;
      },
      notify() {},
    };
    hooks.ui = ui;
    hooks.on("tool_call", async (event) => {
      const ok = await (event.ui as HookUi).confirm("Dangerous", "go?");
      if (!ok) return { block: true, reason: "no" };
    });
    expect(
      await hooks.preToolUse({ id: "1", name: "bash", parameters: {} } as never),
    ).toBe(true);
  });

  it("fail-closed confirm without ui", async () => {
    const hooks = new Hooks();
    hooks.on("tool_call", async (event) => {
      const ok = await (event.ui as HookUi).confirm("x", "y");
      if (!ok) return { block: true, reason: "denied" };
    });
    expect(
      await hooks.preToolUse({ id: "1", name: "write_file", parameters: {} } as never),
    ).toBe(false);
    expect(hooks.lastBlockReason).toBe("denied");
  });

  it("can cancel compaction", async () => {
    const hooks = new Hooks();
    hooks.on("session_before_compact", () => ({ cancel: true }));
    const r = await hooks.preCompact({ sessionId: "s" });
    expect(r.cancel).toBe(true);
  });

  it("can cancel cache rebuild point", async () => {
    const hooks = new Hooks();
    hooks.on("pre_cache_rebuild", () => ({ cancel: true }));
    const r = await hooks.preCacheRebuild({ reason: "session_new" });
    expect(r.cancel).toBe(true);
    expect(hooks.lastCacheRebuildDecision?.cancel).toBe(true);
  });

  it("can rewrite tool_result", async () => {
    const hooks = new Hooks();
    hooks.on("tool_result", () => ({ content: "redacted", isError: false }));
    const r = await hooks.postToolUse(
      { id: "1", name: "reader", parameters: {} } as never,
      { toolCallId: "1", name: "reader", output: "secret", success: true } as never,
    );
    expect(r.content).toBe("redacted");
    expect(hooks.lastToolResultOverride?.content).toBe("redacted");
  });
});
