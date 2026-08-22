import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalTool } from "./tool.js";
import type { ToolContext } from "../../base.js";
import { setDcgEvaluatorForTest, resetDcgBinaryCache } from "../../security/dcg/client.js";
import { setMode, setTerminalPolicyRoot } from "../../security/index.js";
import { resetTerminalBackendForTest } from "../resolve-backend.js";

function stubCtx(agentName: string): ToolContext {
  return {
    projectRoot: process.cwd(),
    workingDir: process.cwd(),
    agentMode: "execute",
    agentName,
    sessionId: "term-mini-test",
    sandboxMode: "yolo",
    terminalBackend: "mini",
  } as ToolContext;
}

describe("use_terminal MAOU_TERMINAL=mini", () => {
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

  it("跑一条 echo 且不加载 .node", async () => {
    process.env.MAOU_TERMINAL = "mini";
    resetTerminalBackendForTest();
    tmp = mkdtempSync(join(tmpdir(), "maou-term-mini-"));
    setTerminalPolicyRoot(tmp);
    const agent = `term-mini-${Date.now()}`;
    setMode(agent, "yolo");
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "allow" as const,
      command: cmd,
      severity: "info" as const,
      ruleId: "test.allow",
      reason: "unit test",
    }));

    const res = await tool.execute(
      {
        action: "run",
        command: "echo hello-mini",
        description: "mini echo",
        reason: "unit test",
      },
      stubCtx(agent),
    );

    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/hello-mini/);
    expect(res.message).toMatch(/terminalBackend=mini/);
  });
});
