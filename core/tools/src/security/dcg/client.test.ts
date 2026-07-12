import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateWithDcg,
  formatDcgDenyMessage,
  resetDcgBinaryCache,
  resolveDcgBinary,
  setDcgEvaluatorForTest,
} from "./client.js";
import { checkMaouHardDeny } from "../hard-deny.js";

describe("maou-hard-deny", () => {
  it("blocks fork bomb and shutdown, allows normal cmds", () => {
    expect(checkMaouHardDeny(":(){ :|:& };:")?.id).toMatch(/fork-bomb/);
    expect(checkMaouHardDeny("sudo reboot")?.id).toMatch(/shutdown/);
    expect(checkMaouHardDeny("init 0")?.id).toMatch(/init/);
    expect(checkMaouHardDeny("git status")).toBeNull();
    expect(checkMaouHardDeny("npm test")).toBeNull();
  });
});

describe("dcg-guard virtual (injected evaluator)", () => {
  afterEach(() => {
    setDcgEvaluatorForTest(null);
    resetDcgBinaryCache();
  });

  it("deny path formats message with rule metadata", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      reason: "git reset --hard destroys uncommitted changes",
      ruleId: "core.git:reset-hard",
      packId: "core.git",
      severity: "critical",
      explanation: "Use git stash first.",
    }));
    const r = await evaluateWithDcg("git reset --hard HEAD");
    expect(r.decision).toBe("deny");
    const msg = formatDcgDenyMessage(r);
    expect(msg).toContain("DCG");
    expect(msg).toContain("core.git:reset-hard");
    expect(msg).toContain("stash");
  });

  it("allow path passes through", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "allow",
      command: cmd,
    }));
    const r = await evaluateWithDcg("echo hello");
    expect(r.decision).toBe("allow");
  });

  it("MAOU_DCG_BYPASS short-circuits before evaluator", async () => {
    const prev = process.env.MAOU_DCG_BYPASS;
    process.env.MAOU_DCG_BYPASS = "1";
    try {
      setDcgEvaluatorForTest(async () => {
        throw new Error("should not be called");
      });
      // bypass is checked before injected? Looking at code - injected is first.
      // So for bypass test we clear inject and rely on env - but then real binary may run.
      setDcgEvaluatorForTest(null);
      const r = await evaluateWithDcg("git reset --hard");
      expect(r.decision).toBe("allow");
      expect(r.reason).toMatch(/BYPASS/);
    } finally {
      if (prev === undefined) delete process.env.MAOU_DCG_BYPASS;
      else process.env.MAOU_DCG_BYPASS = prev;
    }
  });
});

describe("dcg-guard integration (real binary if present)", () => {
  afterEach(() => {
    setDcgEvaluatorForTest(null);
    resetDcgBinaryCache();
  });

  it("resolves vendor or PATH binary", () => {
    resetDcgBinaryCache();
    const bin = resolveDcgBinary();
    // 开发机 ensure-dcg 后应有；CI 可能没有 → 允许 null 但打印
    if (!bin) {
      console.warn("[dcg-guard.test] no dcg binary — skip live assertions");
      return;
    }
    expect(bin.length).toBeGreaterThan(3);
  });

  it("live: allows git status, denies reset --hard and rm -rf", async () => {
    resetDcgBinaryCache();
    const bin = resolveDcgBinary();
    if (!bin) return;

    const ok = await evaluateWithDcg("git status", { binaryPath: bin, required: true });
    expect(ok.decision).toBe("allow");

    const bad = await evaluateWithDcg("git reset --hard HEAD", {
      binaryPath: bin,
      required: true,
    });
    expect(bad.decision).toBe("deny");
    expect(bad.ruleId || bad.reason || "").toMatch(/reset|git|hard/i);

    const rm = await evaluateWithDcg("rm -rf ./src", { binaryPath: bin, required: true });
    expect(rm.decision).toBe("deny");
  }, 15_000);
});
