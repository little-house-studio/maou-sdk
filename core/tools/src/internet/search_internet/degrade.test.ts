import { describe, expect, it } from "vitest";

/**
 * 降级语义契约（与 backends.searchFreeEngines 一致）：
 * - ok → 停止
 * - empty → 才允许试下一引擎
 * - unavailable → 跳过，不算「搜空」
 */
type Status = "ok" | "empty" | "unavailable";

function shouldTryNext(status: Status): boolean {
  return status === "empty" || status === "unavailable";
}

function isDegradeFromEmpty(status: Status): boolean {
  return status === "empty";
}

function pickSource(
  chain: Array<{ source: string; status: Status; results?: string[] }>,
): string | null {
  for (const step of chain) {
    if (step.status === "ok" && step.results && step.results.length > 0) {
      return step.source;
    }
    // empty / unavailable → continue
    if (!shouldTryNext(step.status)) return null;
  }
  return null;
}

describe("search engine degrade contract", () => {
  it("does NOT treat missing CLI as empty-search degrade", () => {
    // 旧 bug：ddgr 未装 → null → 当成失败去 Bing
    // 正确：unavailable 跳过；若后续 empty 才是真正降级
    expect(isDegradeFromEmpty("unavailable")).toBe(false);
    expect(isDegradeFromEmpty("empty")).toBe(true);
  });

  it("stops on first ok with results", () => {
    const src = pickSource([
      { source: "ddgr", status: "unavailable" },
      { source: "ddg-lite", status: "empty" },
      { source: "bing", status: "ok", results: ["a"] },
      { source: "ddg-instant", status: "ok", results: ["b"] },
    ]);
    expect(src).toBe("bing");
  });

  it("skips unavailable then degrades only after empty", () => {
    const trail = [
      { source: "ddgr", status: "unavailable" as const },
      { source: "ddg-lite", status: "empty" as const },
      { source: "bing", status: "ok" as const, results: ["hit"] },
    ];
    expect(trail[0].status).not.toBe("empty");
    expect(isDegradeFromEmpty(trail[1].status)).toBe(true);
    expect(pickSource(trail)).toBe("bing");
  });

  it("all unavailable or empty → null", () => {
    expect(
      pickSource([
        { source: "ddgr", status: "unavailable" },
        { source: "ddg-lite", status: "unavailable" },
        { source: "bing", status: "empty" },
      ]),
    ).toBeNull();
  });
});
