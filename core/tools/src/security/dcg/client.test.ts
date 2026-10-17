import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DCG_EXTRA_PACKS,
  evaluateWithDcg,
  formatDcgDenyMessage,
  resetDcgBinaryCache,
  resolveDcgBinary,
  resolveDcgExtraPacks,
  setDcgBinaryCacheForTest,
  setDcgEvaluatorForTest,
} from "./client.js";
import { checkMaouHardDeny } from "../hard-deny.js";

describe("maou-hard-deny", () => {
  it("blocks shutdown/init, allows fork bomb and normal cmds", () => {
    expect(checkMaouHardDeny("sudo reboot")?.id).toMatch(/shutdown/);
    expect(checkMaouHardDeny("init 0")?.id).toMatch(/init/);
    expect(checkMaouHardDeny(":(){ :|:& };:")).toBeNull();
    expect(checkMaouHardDeny("git status")).toBeNull();
    expect(checkMaouHardDeny("npm test")).toBeNull();
  });
});

describe("default extra packs", () => {
  it("lists official pack ids used at evaluate time", () => {
    expect(DEFAULT_DCG_EXTRA_PACKS).toContain("system.permissions");
    expect(DEFAULT_DCG_EXTRA_PACKS).toContain("system.services");
    expect(DEFAULT_DCG_EXTRA_PACKS).toContain("containers.docker");
    expect(DEFAULT_DCG_EXTRA_PACKS).toContain("package_managers");
    expect(resolveDcgExtraPacks({})).toBe(DEFAULT_DCG_EXTRA_PACKS.join(","));
    expect(resolveDcgExtraPacks({}, { MAOU_DCG_PACKS: "containers.docker" })).toBe(
      "containers.docker",
    );
    expect(resolveDcgExtraPacks({ extraPacks: ["storage.s3"] })).toBe("storage.s3");
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

  it("MAOU_DCG_OPTIONAL allows when binary is missing", async () => {
    const prev = process.env.MAOU_DCG_OPTIONAL;
    process.env.MAOU_DCG_OPTIONAL = "1";
    setDcgEvaluatorForTest(null);
    setDcgBinaryCacheForTest(null);
    try {
      const r = await evaluateWithDcg("npm install");
      expect(r.decision).toBe("allow");
      expect(r.error).toMatch(/optional/);
    } finally {
      if (prev === undefined) delete process.env.MAOU_DCG_OPTIONAL;
      else process.env.MAOU_DCG_OPTIONAL = prev;
    }
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

    const prune = await evaluateWithDcg("docker system prune -af", {
      binaryPath: bin,
      required: true,
      safeAllow: false,
    });
    expect(prune.decision).toBe("deny");
    expect(prune.packId).toBe("containers.docker");
    expect((prune.severity || "").toLowerCase()).toBe("high");
  }, 15_000);
});
