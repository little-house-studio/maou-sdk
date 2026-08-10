/**
 * Terminal security gate → ToolResponse.error.category (real UseTerminalTool path).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalTool } from "./tool.js";
import type { ToolContext } from "../../base.js";
import {
  setDcgEvaluatorForTest,
  resetDcgBinaryCache,
} from "../../security/dcg/client.js";
import {
  setTerminalPolicyRoot,
  setMode,
  setTerminalApprover,
} from "../../security/index.js";

function stubCtx(agentName: string, sandboxMode?: string): ToolContext {
  return {
    projectRoot: process.cwd(),
    workingDir: process.cwd(),
    agentMode: "execute",
    agentName,
    sessionId: "term-sec-test",
    sandboxMode: sandboxMode ?? "normal",
  } as ToolContext;
}

describe("use_terminal security → tool error category", () => {
  let tmp: string;
  const tool = new TerminalTool();

  afterEach(() => {
    setDcgEvaluatorForTest(null);
    resetDcgBinaryCache();
    setTerminalApprover(null);
    if (tmp) {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it("deny_fatal under yolo → policy_denied (real execute + gate)", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-term-sec-"));
    setTerminalPolicyRoot(tmp);
    setMode("term-sec-ag", "yolo");

    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny" as const,
      command: cmd,
      severity: "critical" as const,
      ruleId: "core.git:reset-hard",
      reason: "hard reset blocked",
    }));

    const res = await tool.execute(
      {
        action: "run",
        command: "git reset --hard HEAD",
        description: "test fatal gate",
        reason: "unit test",
      },
      stubCtx("term-sec-ag", "yolo"),
    );

    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("policy_denied");
    expect(res.message.length).toBeGreaterThan(0);
  });

  it("user reject on dangerous path → user_rejected", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-term-ask-"));
    setTerminalPolicyRoot(tmp);
    // Fresh agent name so double-confirm window does not auto-allow
    const agent = `term-ask-${Date.now()}`;
    setMode(agent, "normal");

    // Same pattern as gate.test: dangerous non-fatal under normal → deny_dangerous_pending
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny" as const,
      command: cmd,
      severity: "high" as const,
      ruleId: "core.git:clean-force",
      reason: "git clean -f",
    }));

    setTerminalApprover(async () => ({
      approve: false,
      persist: "none" as const,
    }));

    const res = await tool.execute(
      {
        action: "run",
        command: "git clean -fd",
        description: "test user deny",
        reason: "unit test",
      },
      stubCtx(agent, "normal"),
    );

    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("user_rejected");
    expect(res.error?.code).toMatch(/user-denied|denied/i);
  });
});
