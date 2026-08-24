/**
 * use_terminal 专用 hook：审批之后、真正跑命令 / write / stop / rm 时。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalTool } from "./tool.js";
import type { ToolContext } from "../../base.js";
import { setDcgEvaluatorForTest, resetDcgBinaryCache } from "../../security/dcg/client.js";
import { setMode, setTerminalPolicyRoot } from "../../security/index.js";
import { resetTerminalBackendForTest } from "../resolve-backend.js";
import { bindTerminalHookHost } from "../terminal-hook-host.js";

function stubCtx(agentName: string): ToolContext {
  return {
    projectRoot: process.cwd(),
    workingDir: process.cwd(),
    agentMode: "execute",
    agentName,
    sessionId: "term-hook-test",
    sandboxMode: "yolo",
    terminalBackend: "mini",
  } as ToolContext;
}

describe("use_terminal 终端 hook", () => {
  let tmp: string;
  const tool = new TerminalTool();
  const prev = process.env.MAOU_TERMINAL;

  afterEach(() => {
    bindTerminalHookHost(null);
    if (prev === undefined) delete process.env.MAOU_TERMINAL;
    else process.env.MAOU_TERMINAL = prev;
    resetTerminalBackendForTest();
    setDcgEvaluatorForTest(null);
    resetDcgBinaryCache();
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  function setup(agent: string): void {
    process.env.MAOU_TERMINAL = "mini";
    resetTerminalBackendForTest();
    tmp = mkdtempSync(join(tmpdir(), "maou-term-hook-"));
    setTerminalPolicyRoot(tmp);
    setMode(agent, "yolo");
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "allow" as const,
      command: cmd,
      severity: "info" as const,
      ruleId: "test.allow",
      reason: "unit test",
    }));
  }

  it("terminal_pre_run 拒绝后不执行", async () => {
    const agent = `hook-deny-${Date.now()}`;
    setup(agent);
    bindTerminalHookHost({
      gate: async (name) => {
        if (name === "terminal_pre_run") return { allowed: false, reason: "blocked by hook" };
      },
    });
    const res = await tool.execute(
      { action: "run", command: "echo should-not-run", description: "x", reason: "unit test" },
      stubCtx(agent),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("policy_denied");
    expect(res.message).toMatch(/blocked by hook/);
    expect(res.message).toMatch(/终端钩子拒绝了 run/);
  });

  it("terminal_pre_run 可改写命令", async () => {
    const agent = `hook-rw-${Date.now()}`;
    setup(agent);
    bindTerminalHookHost({
      gate: async (name) => {
        if (name === "terminal_pre_run") {
          return { allowed: true, command: "echo rewritten-hook" };
        }
      },
    });
    const res = await tool.execute(
      { action: "run", command: "echo original-hook", description: "x", reason: "unit test" },
      stubCtx(agent),
    );
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/rewritten-hook/);
    expect(res.message).not.toMatch(/original-hook/);
  });

  it("前台完成打 started + exit；list/logs 不打", async () => {
    const agent = `hook-emit-${Date.now()}`;
    setup(agent);
    const ctx = stubCtx(agent);
    const events: string[] = [];
    bindTerminalHookHost({
      emit: (name) => {
        events.push(name);
      },
    });
    const res = await tool.execute(
      { action: "run", command: "echo hook-emit", description: "x", reason: "unit test" },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(events).toEqual(["terminal_started", "terminal_exit"]);

    await tool.execute(
      { action: "manage", manage_action: "list", reason: "unit test" },
      ctx,
    );
    expect(events).toEqual(["terminal_started", "terminal_exit"]);
  });

  it("前台超时打 promoted；manage stop/rm 打对应事件", async () => {
    const agent = `hook-promo-${Date.now()}`;
    setup(agent);
    const ctx = stubCtx(agent);
    const events: string[] = [];
    bindTerminalHookHost({
      emit: (name) => {
        events.push(name);
      },
    });
    const cmd = process.platform === "win32" ? "ping -n 20 127.0.0.1" : "sleep 20";
    const res = await tool.execute(
      {
        action: "run",
        command: cmd,
        description: "sleep",
        reason: "unit test",
        timeout: 1,
      },
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.payload?.promoted_to_background).toBe(true);
    expect(events).toEqual(["terminal_started", "terminal_promoted"]);
    const tid = String(res.payload?.terminal_id);

    await tool.execute(
      { action: "manage", manage_action: "stop", id: tid, reason: "unit test" },
      ctx,
    );
    await tool.execute(
      { action: "manage", manage_action: "rm", id: tid, reason: "unit test" },
      ctx,
    );
    expect(events).toEqual([
      "terminal_started",
      "terminal_promoted",
      "terminal_stop",
      "terminal_rm",
    ]);
  });

  it("terminal_pre_stop 可拦 manage stop", async () => {
    const agent = `hook-stop-${Date.now()}`;
    setup(agent);
    const ctx = stubCtx(agent);
    const cmd = process.platform === "win32" ? "ping -n 20 127.0.0.1" : "sleep 20";
    const started = await tool.execute(
      {
        action: "run",
        command: cmd,
        background: true,
        id: "stay",
        description: "stay",
        reason: "unit test",
      },
      ctx,
    );
    expect(started.ok).toBe(true);

    bindTerminalHookHost({
      gate: async (name) => {
        if (name === "terminal_pre_stop") return { allowed: false, reason: "keep it" };
      },
    });
    const stopped = await tool.execute(
      { action: "manage", manage_action: "stop", id: "stay", reason: "unit test" },
      ctx,
    );
    expect(stopped.ok).toBe(false);
    expect(stopped.error?.category).toBe("policy_denied");
    expect(stopped.message).toMatch(/keep it/);

    bindTerminalHookHost(null);
    await tool.execute(
      { action: "manage", manage_action: "stop", id: "stay", reason: "unit test" },
      ctx,
    );
    await tool.execute(
      { action: "manage", manage_action: "rm", id: "stay", reason: "unit test" },
      ctx,
    );
  });

  it("terminal_pre_write 拒绝先于后端 write", async () => {
    const agent = `hook-wr-${Date.now()}`;
    setup(agent);
    bindTerminalHookHost({
      gate: async (name) => {
        if (name === "terminal_pre_write") return { allowed: false, reason: "no keys" };
      },
    });
    const res = await tool.execute(
      { action: "write", id: "nope", data: "x", reason: "unit test" },
      stubCtx(agent),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("policy_denied");
    expect(res.message).toMatch(/no keys/);
    expect(res.message).not.toMatch(/不支持 write/);
  });
});
