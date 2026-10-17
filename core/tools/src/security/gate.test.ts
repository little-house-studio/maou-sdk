import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessCommandSecurity,
  gateTerminalCommand,
  mapDcgDenyToTier,
} from "./gate.js";

const USER_ABS_RM =
  "rm -rf /Users/mac/Documents/移植/正太勇者的崛起/.dcgtest/sub";
import { setDcgEvaluatorForTest, resetDcgBinaryCache } from "./dcg/client.js";
import { setTerminalPolicyRoot, setMode } from "./approval/terminal-policy.js";

describe("mapDcgDenyToTier", () => {
  it("maps critical reset-hard to fatal", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "critical",
        ruleId: "core.git:reset-hard",
      }),
    ).toBe("fatal");
  });

  it("maps critical clean-force to fatal", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "critical",
        ruleId: "core.git:clean-force",
      }),
    ).toBe("fatal");
  });

  it("maps high rm-rf-general to dangerous", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "high",
        ruleId: "core.filesystem:rm-rf-general",
      }),
    ).toBe("dangerous");
  });

  it("maps high restore to dangerous", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "high",
        ruleId: "core.git:restore",
      }),
    ).toBe("dangerous");
  });

  it("maps medium / missing / other non-critical to dangerous", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "medium",
      }),
    ).toBe("dangerous");
    expect(mapDcgDenyToTier({ decision: "deny", command: "x" })).toBe("dangerous");
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "low",
      }),
    ).toBe("dangerous");
  });

  it("treats severity case-insensitively after trim", () => {
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: " CRITICAL ",
      }),
    ).toBe("fatal");
    expect(
      mapDcgDenyToTier({
        decision: "deny",
        command: "x",
        severity: "High",
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

  it("fatal: clean-force critical is not double-confirmable", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-sec-clean-"));
    setTerminalPolicyRoot(tmp);
    setMode("ag", "yolo");

    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "critical",
      ruleId: "core.git:clean-force",
      reason: "git clean -f",
    }));

    const g1 = await gateTerminalCommand("git clean -fd", "ag", "yolo");
    expect(g1.action).toBe("deny_fatal");
    expect(g1.assessment.tier).toBe("fatal");

    const g2 = await gateTerminalCommand("git clean -fd", "ag", "normal");
    expect(g2.action).toBe("deny_fatal");
  });

  it("dangerous: first deny, second identical allows", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-sec2-"));
    setTerminalPolicyRoot(tmp);

    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "high",
      ruleId: "core.filesystem:rm-rf-general",
      reason: "rm -rf",
    }));

    const g1 = await gateTerminalCommand("rm -rf ./src", "ag", "normal");
    expect(g1.action).toBe("deny_dangerous_pending");
    expect(g1.assessment.tier).toBe("dangerous");

    const g2 = await gateTerminalCommand("rm -rf ./src", "ag", "normal");
    expect(g2.action).toBe("allow");
  });

  it("dangerous: yolo allows without second confirm", async () => {
    tmp = mkdtempSync(join(tmpdir(), "maou-sec-yolo-"));
    setTerminalPolicyRoot(tmp);
    setMode("ag", "yolo");

    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "high",
      ruleId: "core.filesystem:rm-rf-general",
      reason: "rm -rf",
    }));

    const g = await gateTerminalCommand("rm -rf ./src", "ag", "yolo");
    expect(g.action).toBe("allow");
    expect(g.assessment.tier).toBe("dangerous");
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
    }));
    const a = await assessCommandSecurity("rm -rf dist");
    expect(a.tier).toBe("safe");
    expect(a.source).toBe("maou-safe");
  });

  it("deep home rm-rf-root-home is safe-allow, not fatal", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "critical",
      ruleId: "core.filesystem:rm-rf-root-home",
      reason: "rm-rf-root-home",
    }));
    const a = await assessCommandSecurity(USER_ABS_RM);
    expect(a.tier).not.toBe("fatal");
    expect(a.tier).toBe("safe");
    expect(a.source).toBe("maou-safe");
  });

  it("DCG deny+high stays dangerous", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      severity: "high",
      ruleId: "core.filesystem:rm-rf-general",
      reason: "rm -rf",
    }));
    const a = await assessCommandSecurity("rd /s /q C:\\temp");
    expect(a.tier).toBe("dangerous");
    expect(a.source).toBe("dcg");
  });

  it("maou hard deny is fatal", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({ decision: "allow", command: cmd }));
    const a = await assessCommandSecurity("sudo reboot");
    expect(a.tier).toBe("fatal");
    expect(a.source).toBe("maou-hard");
  });
});
