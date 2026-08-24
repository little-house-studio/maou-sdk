import { describe, expect, it } from "vitest";
import { Hooks, type HookUi, isHookContinue } from "./hooks.js";

describe("Pi-style async hooks", () => {
  it("blocks tool_call with { block, reason }", async () => {
    const hooks = new Hooks();
    hooks.on("tool_call", (event) => {
      if (event.piToolName === "bash" || event.toolName === "use_terminal") {
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

  it("stop { continue } 视为拦住收尾", async () => {
    const hooks = new Hooks();
    hooks.on("Stop", () => ({ continue: true, reason: "还有测试没跑" }));
    const r = await hooks.stop({ sessionId: "s" });
    expect(isHookContinue(r)).toBe(true);
    expect(r.blockReason).toBe("还有测试没跑");
  });

  it("permission_request { approve: true } 放行", async () => {
    const hooks = new Hooks();
    hooks.on("PermissionRequest", () => ({ approve: true }));
    const r = await hooks.permissionRequest({ command: "ls" });
    expect(r.decision).toBe("allow");
    expect(r.allowed).toBe(true);
  });

  it("permission_request deny 不可被后一个 allow 翻案", async () => {
    const hooks = new Hooks();
    hooks.on("permission_request", () => ({ decision: "deny", reason: "no" }));
    hooks.on("permission_request", () => ({ decision: "allow" }));
    const r = await hooks.permissionRequest({ command: "rm -rf /" });
    expect(r.decision).toBe("deny");
    expect(r.allowed).toBe(false);
  });

  it("失败走 post_tool_use_failure 不打 post_tool_use", async () => {
    const hooks = new Hooks();
    const seen: string[] = [];
    hooks.on("post_tool_use", () => {
      seen.push("ok");
    });
    hooks.on("PostToolUseFailure", () => {
      seen.push("fail");
      return { content: "masked" };
    });
    const r = await hooks.postToolUseFailure(
      { id: "1", name: "use_terminal", parameters: {} } as never,
      { toolCallId: "1", name: "use_terminal", output: "boom", success: false } as never,
    );
    expect(seen).toEqual(["fail"]);
    expect(r.content).toBe("masked");
  });

  it("pre_message 可拦截", async () => {
    const hooks = new Hooks();
    hooks.on("UserPromptSubmit", () => ({ block: true, reason: "blocked prompt" }));
    const r = await hooks.preMessage({ role: "user", content: "hi" } as never);
    expect(r.allowed).toBe(false);
    expect(r.blockReason).toBe("blocked prompt");
  });

  it("dsh tools/pre-execute ask 走 permission_request 语义", async () => {
    const hooks = new Hooks();
    hooks.on("tools/pre-execute", () => ({ decision: "ask" }));
    const r = await hooks.preToolUseGate({
      id: "1",
      name: "write_file",
      parameters: {},
    } as never);
    expect(r.decision).toBe("ask");
    expect(r.allowed).toBe(true);
  });

  it("dsh agent/pre-step 可拒本步", async () => {
    const hooks = new Hooks();
    hooks.on("agent_pre_step", () => ({ block: true, reason: "skip step" }));
    const r = await hooks.beforeAgentStart({ roundNumber: 1 });
    expect(r.allowed).toBe(false);
    expect(r.blockReason).toBe("skip step");
  });

  it("terminal_pre_run 可拦并可改写 command", async () => {
    const hooks = new Hooks();
    hooks.on("TerminalPreRun", () => ({ command: "echo safe" }));
    const r = await hooks.terminalPreRun({ command: "rm -rf /" });
    expect(r.allowed).toBe(true);
    expect(r.command).toBe("echo safe");

    hooks.on("terminal_pre_run", () => ({ block: true, reason: "no shells" }));
    const denied = await hooks.terminalPreRun({ command: "ls" });
    expect(denied.allowed).toBe(false);
    expect(denied.blockReason).toBe("no shells");
  });
});
