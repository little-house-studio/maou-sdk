import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalTool } from "./tool.js";
import type { ToolContext } from "../../base.js";
import { setDcgEvaluatorForTest, resetDcgBinaryCache } from "../../security/dcg/client.js";
import {
  setMode,
  setTerminalPolicyRoot,
  setCageOverride,
  resetCageForTest,
} from "../../security/index.js";

function stubCtx(agentName: string): ToolContext {
  return {
    projectRoot: process.cwd(),
    workingDir: process.cwd(),
    agentMode: "execute",
    agentName,
    sessionId: "term-cage-test",
    sandboxMode: "yolo",
    cageIsolation: "workspace",
    terminalBackend: "mini",
  } as ToolContext;
}

describe("use_terminal OS cage", () => {
  let tmp: string;
  const tool = new TerminalTool();

  afterEach(() => {
    resetCageForTest();
    setDcgEvaluatorForTest(null);
    resetDcgBinaryCache();
    if (tmp) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it("does not execute when cage is unavailable", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-term-cage-"));
    setTerminalPolicyRoot(tmp);
    const agent = `term-cage-${Date.now()}`;
    setMode(agent, "yolo");
    setCageOverride("unavailable");
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "allow" as const,
      command: cmd,
      severity: "info" as const,
    }));
    const res = await tool.execute(
      { action: "run", command: "echo should-not-run", description: "t", reason: "t" },
      stubCtx(agent),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("cage_unavailable");
    expect(res.message).not.toContain("should-not-run\n");
  });
});
