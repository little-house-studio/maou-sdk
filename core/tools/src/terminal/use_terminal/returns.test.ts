/**
 * use_terminal 返回消息 / payload / 临时终端销毁 / manage / write(mini)
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

function stubCtx(agentName: string, projectRoot: string): ToolContext {
  return {
    projectRoot,
    workingDir: projectRoot,
    agentMode: "execute",
    agentName,
    sessionId: "term-returns-test",
    sandboxMode: "yolo",
    terminalBackend: "mini",
  } as ToolContext;
}

describe("use_terminal 消息返回", () => {
  let tmp: string;
  const tool = new TerminalTool();
  const prev = process.env.MAOU_TERMINAL;

  afterEach(() => {
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
    tmp = mkdtempSync(join(tmpdir(), "maou-term-ret-"));
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

  it("echo 成功：正文 + metadata + payload + footer + 临时终端销毁", async () => {
    const agent = `ret-echo-${Date.now()}`;
    setup(agent);
    const ctx = stubCtx(agent, tmp);

    const res = await tool.execute(
      {
        action: "run",
        command: "echo hello-returns",
        description: "echo",
        reason: "unit test",
      },
      ctx,
    );

    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/hello-returns/);
    expect(res.message).toMatch(/exit_code/);
    expect(res.message).toMatch(/terminal_id/);
    expect(res.message).toMatch(/── 终端状态 ──/);
    expect(res.message).toMatch(/当前没有终端/);
    expect(res.message).toMatch(/terminalBackend=mini/);
    expect(res.payload).toMatchObject({
      exit_code: 0,
      terminal_backend: "mini",
      terminal_degraded: false,
      terminals_total: 0,
      terminals_running: 0,
    });
    expect(res.payload?.terminal_id).toBeTruthy();

    const listed = await tool.execute(
      { action: "manage", manage_action: "list", reason: "unit test" },
      ctx,
    );
    expect(listed.ok).toBe(true);
    expect(listed.message).toMatch(/当前没有终端/);
    expect(listed.payload).toMatchObject({
      count: 0,
      terminal_backend: "mini",
      terminals_total: 0,
    });
    expect(listed.message).not.toMatch(/── 终端状态 ──/);
  });

  it("非零退出：ok=false，payload.exit_code 保留", async () => {
    const agent = `ret-fail-${Date.now()}`;
    setup(agent);
    const cmd = "exit 7";
    const res = await tool.execute(
      { action: "run", command: cmd, description: "fail", reason: "unit test" },
      stubCtx(agent, tmp),
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/失败|退出码/);
    expect(res.payload?.exit_code).toBe(7);
    expect(res.payload?.terminal_backend).toBe("mini");
  });

  it("前台超时：转后台并汇报，进程仍在", async () => {
    const agent = `ret-to-${Date.now()}`;
    setup(agent);
    const ctx = stubCtx(agent, tmp);
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
    expect(res.background).toBe(true);
    expect(res.message).toMatch(/转入后台|转后台/);
    expect(res.message).not.toMatch(/终止进程/);
    expect(res.payload?.exit_code).toBeNull();
    expect(res.payload?.promoted_to_background).toBe(true);
    expect(res.payload?.terminal_id).toBeTruthy();

    const listed = await tool.execute(
      { action: "manage", manage_action: "list", reason: "unit test" },
      ctx,
    );
    expect(listed.message).toMatch(/running|运行/);
    await tool.execute(
      {
        action: "manage",
        manage_action: "stop",
        id: String(res.payload?.terminal_id),
        reason: "unit test",
      },
      ctx,
    );
  });

  it("后台 + logs + stop + rm 的 payload/正文", async () => {
    const agent = `ret-bg-${Date.now()}`;
    setup(agent);
    const ctx = stubCtx(agent, tmp);
    const cmd = process.platform === "win32" ? "ping -n 20 127.0.0.1" : "sleep 20";
    const started = await tool.execute(
      {
        action: "run",
        command: cmd,
        background: true,
        id: "bg-sleep",
        description: "长睡",
        reason: "unit test",
      },
      ctx,
    );
    expect(started.ok).toBe(true);
    expect(started.message).toMatch(/后台运行|已在后台/);
    expect(started.payload).toMatchObject({ terminal_id: "bg-sleep" });
    expect(started.payload?.terminals_running).toBeGreaterThanOrEqual(1);

    const logs = await tool.execute(
      { action: "manage", manage_action: "logs", id: "bg-sleep", reason: "unit test" },
      ctx,
    );
    expect(logs.ok).toBe(true);
    expect(logs.message).toMatch(/status|运行中|bg-sleep/);
    expect(logs.payload).toMatchObject({ id: "bg-sleep" });

    const stopped = await tool.execute(
      { action: "manage", manage_action: "stop", id: "bg-sleep", reason: "unit test" },
      ctx,
    );
    expect(stopped.ok).toBe(true);
    expect(stopped.message).toMatch(/终止/);
    expect(stopped.payload).toMatchObject({ id: "bg-sleep" });

    const rm = await tool.execute(
      { action: "manage", manage_action: "rm", id: "bg-sleep", reason: "unit test" },
      ctx,
    );
    expect(rm.ok).toBe(true);
    expect(rm.message).toMatch(/已删除/);
    expect(rm.payload).toMatchObject({ id: "bg-sleep", terminals_total: 0 });
  });

  it("mini write 返回不支持错误", async () => {
    const agent = `ret-wr-${Date.now()}`;
    setup(agent);
    const res = await tool.execute(
      { action: "write", id: "nope", data: "x", reason: "unit test" },
      stubCtx(agent, tmp),
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/不支持 write/);
  });
});
