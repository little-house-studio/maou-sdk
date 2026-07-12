import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessCommandSecurity,
  gateTerminalCommand,
  mapDcgDenyToTier,
} from "./gate.js";
import { setDcgEvaluatorForTest, resetDcgBinaryCache } from "./dcg/client.js";
import { setTerminalPolicyRoot, setMode } from "./approval/terminal-policy.js";

describe("mapDcgDenyToTier", () => {
  it("maps reset-hard to fatal even if high", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "critical",
        ruleId: "core.git:reset-hard",
      }),
    ).toBe("fatal");
  });

  it("maps clean-force critical to dangerous (double-confirm)", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "critical",
        ruleId: "core.git:clean-force",
      }),
    ).toBe("dangerous");
  });

  it("maps generic high rm-rf-general to dangerous", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "high",
        ruleId: "core.filesystem:rm-rf-general",
      }),
    ).toBe("dangerous");
  });
});

describe("three-tier gate", () => {
  let tmp: string;

  afterEach(() => {
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

  it("fatal: hard deny, second run still deny", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-sec-"));
    setTerminalPolicyRoot(tmp);
    setMode("ag", "yolo");

    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "critical",
      ruleId: "core.git:reset-hard",
      reason: "hard reset",
    }));

    const g1 = await gateTerminalCommand("git reset --hard HEAD", "ag", "yolo");
    expect(g1.action).toBe("deny_fatal");
    expect(g1.assessment.tier).toBe("fatal");

    const g2 = await gateTerminalCommand("git reset --hard HEAD", "ag", "yolo");
    expect(g2.action).toBe("deny_fatal");
  });

  it("dangerous: first deny, second identical allows", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-sec2-"));
    setTerminalPolicyRoot(tmp);

    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "high",
      ruleId: "core.git:clean-force",
      reason: "git clean -f",
    }));

    const g1 = await gateTerminalCommand("git clean -fd", "ag", "normal");
    expect(g1.action).toBe("deny_dangerous_pending");
    expect(g1.assessment.tier).toBe("dangerous");

    const g2 = await gateTerminalCommand("git clean -fd", "ag", "normal");
    expect(g2.action).toBe("allow");
  });

  it("safe: yolo allows ordinary command", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "allow",
      command: cmd,
    }));
    const g = await gateTerminalCommand("npm test", "ag", "yolo");
    expect(g.action).toBe("allow");
    expect(g.assessment.tier).toBe("safe");
  });

  it("maou safe allow elevates dist rm to safe", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "high",
      ruleId: "core.filesystem:rm-rf-general",
      reason: "rm -rf",
      // simulate applySafeAllow already done by evaluateWithDcg — inject post-allow:
    }));
    // inject raw deny; evaluateWithDcg will apply safe allow when not using pure inject path...
    // setDcgEvaluatorForTest returns before safe allow applied in evaluateWithDcg - applySafeAllow wraps inject.
    const a = await assessCommandSecurity("rm -rf dist");
    expect(a.tier).toBe("safe");
    expect(a.source).toBe("maou-safe");
  });

  it("maou hard deny is fatal", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({ decision: "allow", command: cmd }));
    const a = await assessCommandSecurity("sudo reboot");
    expect(a.tier).toBe("fatal");
    expect(a.source).toBe("maou-hard");
  });
});
