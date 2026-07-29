import { describe, expect, it } from "vitest";
import { matchMaouSafeAllow } from "./safe-allow.js";
import { evaluateWithDcg, setDcgEvaluatorForTest, resetDcgBinaryCache } from "./client.js";
import { afterEach } from "vitest";

describe("maou-dcg-allow (safe overrides)", () => {
  it("allows artifact rm -rf, denies source/tree rm -rf", () => {
    expect(matchMaouSafeAllow("rm -rf dist")?.id).toMatch(/rm-rf-artifacts/);
    expect(matchMaouSafeAllow("rm -rf ./node_modules")).toBeTruthy();
    expect(matchMaouSafeAllow("rm -rf build .next coverage")).toBeTruthy();
    expect(matchMaouSafeAllow("rm -rf packages/foo/dist")).toBeTruthy();
    expect(matchMaouSafeAllow("rm -rf src")).toBeNull();
    expect(matchMaouSafeAllow("rm -rf .")).toBeNull();
    expect(matchMaouSafeAllow("rm -rf *")).toBeNull();
    expect(matchMaouSafeAllow("rm -rf ../secret")).toBeNull();
    expect(matchMaouSafeAllow("rm -rf /etc/passwd")).toBeNull();
  });

  it("allows single-file restore/checkout discard, not whole tree", () => {
    expect(matchMaouSafeAllow("git restore file.ts")?.id).toMatch(/restore/);
    expect(matchMaouSafeAllow("git checkout -- path/a.ts")).toBeTruthy();
    expect(matchMaouSafeAllow("git restore .")).toBeNull();
    expect(matchMaouSafeAllow("git checkout -- .")).toBeNull();
  });

  it("allows branch -D and stash drop, not stash clear", () => {
    expect(matchMaouSafeAllow("git branch -D feature/x")).toBeTruthy();
    expect(matchMaouSafeAllow("git stash drop")).toBeTruthy();
    expect(matchMaouSafeAllow("git stash drop stash@{1}")).toBeTruthy();
    expect(matchMaouSafeAllow("git stash clear")).toBeNull();
  });

  it("allows find -delete under artifact roots only", () => {
    expect(matchMaouSafeAllow('find dist -type f -delete')).toBeTruthy();
    expect(matchMaouSafeAllow('find . -name "*.log" -delete')).toBeNull();
  });

  it("allows awk printf %% and readonly ps pipelines", () => {
    expect(
      matchMaouSafeAllow(
        `ps -eo pid,%cpu,%mem,rss,comm -r | head -21 | awk '{printf "%5s%% %s\\n", $1, $5}'`,
      )?.id,
    ).toMatch(/awk|readonly/);
    expect(
      matchMaouSafeAllow(`awk 'BEGIN{printf "%%s\\n", "x"}'`),
    ).toBeTruthy();
    expect(matchMaouSafeAllow("ps aux | head -20")?.id).toMatch(/readonly|awk/);
    // 破坏性仍不放行
    expect(matchMaouSafeAllow("awk '{print}' | rm -rf /")).toBeNull();
  });
});

describe("evaluateWithDcg applies safe allow after DCG deny", () => {
  afterEach(() => {
    setDcgEvaluatorForTest(null);
    resetDcgBinaryCache();
  });

  it("overrides deny for rm -rf dist", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      ruleId: "core.filesystem:rm-rf-general",
      reason: "rm -rf blocked",
    }));
    const r = await evaluateWithDcg("rm -rf dist");
    expect(r.decision).toBe("allow");
    expect(r.maouSafeAllow?.id).toMatch(/rm-rf-artifacts/);
  });

  it("keeps deny for rm -rf src", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      ruleId: "core.filesystem:rm-rf-general",
      reason: "rm -rf blocked",
    }));
    const r = await evaluateWithDcg("rm -rf src");
    expect(r.decision).toBe("deny");
    expect(r.maouSafeAllow).toBeUndefined();
  });

  it("strict mode disables override", async () => {
    setDcgEvaluatorForTest(async (cmd) => ({
      decision: "deny",
      command: cmd,
      ruleId: "core.filesystem:rm-rf-general",
    }));
    const prev = process.env.MAOU_DCG_STRICT;
    process.env.MAOU_DCG_STRICT = "1";
    try {
      const r = await evaluateWithDcg("rm -rf dist");
      expect(r.decision).toBe("deny");
    } finally {
      if (prev === undefined) delete process.env.MAOU_DCG_STRICT;
      else process.env.MAOU_DCG_STRICT = prev;
    }
  });
});
