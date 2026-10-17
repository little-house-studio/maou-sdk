/**
 * return_when=until 挂已有后台任务（省略 command / 忽略新 command）
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
    sessionId: "term-until-attach-test",
    sandboxMode: "yolo",
    terminalBackend: "mini",
  } as ToolContext;
}

describe("use_terminal until attach", () => {
  let tmp: string;
  const tool = new TerminalTool();
  const prev = process.env.MAOU_TERMINAL;

  afterEach(async () => {
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

  function setup(agent: string): ToolContext {
    process.env.MAOU_TERMINAL = "mini";
    resetTerminalBackendForTest();
    tmp = mkdtempSync(join(tmpdir(), "maou-until-att-"));
    setTerminalPolicyRoot(tmp);
    setMode(agent, "yolo");
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "allow" as const,
      command: cmd,
      severity: "info" as const,
      ruleId: "test.allow",
      reason: "unit test",
    }));
    return stubCtx(agent, tmp);
  }

  it("挂到已有后台 id，无需 command，命中即返回", async () => {
    const agent = `until-att-${Date.now()}`;
    const ctx = setup(agent);
    const cmd =
      process.platform === "win32"
        ? "cmd /c echo READY_UNTIL_ATTACH & ping -n 20 127.0.0.1 >nul"
        : "sh -c 'echo READY_UNTIL_ATTACH; sleep 20'";

    const started = await tool.execute(
      {
        action: "run",
        command: cmd,
        background: true,
        id: "until-bg",
        description: "挂接源",
        reason: "unit test",
      },
      ctx,
    );
    expect(started.ok).toBe(true);

    const until = await tool.execute(
      {
        action: "run",
        id: "until-bg",
        return_when: "until",
        match: "READY_UNTIL_ATTACH",
        description: "等标记",
        reason: "unit test",
        timeout: 8,
      },
      ctx,
    );
    expect(until.ok).toBe(true);
    expect(until.message).toMatch(/READY_UNTIL_ATTACH/);
    expect(until.payload?.return_when).toBe("until");

    await tool.execute(
      { action: "manage", manage_action: "stop", id: "until-bg", reason: "unit test" },
      ctx,
    );
    await tool.execute(
      { action: "manage", manage_action: "rm", id: "until-bg", reason: "unit test" },
      ctx,
    );
  });

  it("id 已在跑时忽略新 command，不报 AlreadyRunning", async () => {
    const agent = `until-ign-${Date.now()}`;
    const ctx = setup(agent);
    const cmd =
      process.platform === "win32"
        ? "cmd /c echo KEEP_BG_MARK & ping -n 20 127.0.0.1 >nul"
        : "sh -c 'echo KEEP_BG_MARK; sleep 20'";

    await tool.execute(
      {
        action: "run",
        command: cmd,
        background: true,
        id: "until-keep",
        description: "原任务",
        reason: "unit test",
      },
      ctx,
    );

    const until = await tool.execute(
      {
        action: "run",
        id: "until-keep",
        command: "echo SHOULD_NOT_SPAWN",
        return_when: "until",
        match: "KEEP_BG_MARK",
        description: "误带 command",
        reason: "unit test",
        timeout: 8,
      },
      ctx,
    );
    expect(until.ok).toBe(true);
    expect(until.message).toMatch(/KEEP_BG_MARK/);
    expect(until.message).not.toMatch(/AlreadyRunning|正在运行，不能重复/);

    await tool.execute(
      { action: "manage", manage_action: "stop", id: "until-keep", reason: "unit test" },
      ctx,
    );
    await tool.execute(
      { action: "manage", manage_action: "rm", id: "until-keep", reason: "unit test" },
      ctx,
    );
  });

  it("问题3：已结束 id 省略 command 挂 until 报友好提示，不报「必须提供 command」", async () => {
    const agent = `until-exit-${Date.now()}`;
    const ctx = setup(agent);

    // 起一个快速结束的后台任务
    await tool.execute(
      {
        action: "run",
        command: "echo DONE_FAST",
        background: true,
        id: "until-exited",
        description: "快速结束",
        reason: "unit test",
      },
      ctx,
    );
    // 等它结束
    await new Promise((r) => setTimeout(r, 1200));

    const until = await tool.execute(
      {
        action: "run",
        id: "until-exited",
        return_when: "until",
        match: "DONE_FAST",
        description: "挂已结束任务",
        reason: "unit test",
      },
      ctx,
    );
    expect(until.ok).toBe(false);
    expect(until.message).toMatch(/已结束/);
    expect(until.message).toMatch(/manage logs/);
    expect(until.message).not.toMatch(/必须提供 command/);
    expect(until.payload?.id).toBe("until-exited");
  });

  it("问题3：不存在的 id 省略 command 挂 until 报终端不存在", async () => {
    const agent = `until-nope-${Date.now()}`;
    const ctx = setup(agent);

    const until = await tool.execute(
      {
        action: "run",
        id: "never-existed",
        return_when: "until",
        match: "X",
        description: "挂不存在任务",
        reason: "unit test",
      },
      ctx,
    );
    expect(until.ok).toBe(false);
    expect(until.message).toMatch(/不存在/);
  });
});
