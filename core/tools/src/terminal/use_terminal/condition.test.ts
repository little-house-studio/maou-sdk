import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evalConditionOnFile,
  evalConditionOnText,
  resolveExpr,
  validateConditionParams,
} from "./condition.js";

describe("terminal condition return", () => {
  it("resolveExpr defaults", () => {
    expect(resolveExpr(undefined, "a=(\\d+)")).toBe("m is not None");
    expect(resolveExpr("m and int(m.group(1))>0", "x")).toContain("group");
  });

  it("validateConditionParams", () => {
    expect(validateConditionParams({})).toBeNull();
    expect(validateConditionParams({ returnWhen: "filter" })).toMatch(/expr/);
    expect(
      validateConditionParams({ returnWhen: "filter", match: "a" }),
    ).toBeNull();
  });

  it("filter file: 2 < a < 5", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-cond-"));
    const path = join(dir, "data.txt");
    writeFileSync(
      path,
      ["a = 1", "a = 3", "b = 4", "a = 4", "a = 10", "a = 2"].join("\n"),
      "utf-8",
    );
    const r = await evalConditionOnFile(path, {
      mode: "filter",
      match: String.raw`a\s*=\s*(\d+)`,
      expr: "m is not None and 2 < int(m.group(1)) < 5",
    });
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(2);
    const texts = (r.hits ?? []).map((h) => h.text);
    expect(texts).toContain("a = 3");
    expect(texts).toContain("a = 4");
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  });

  it("until text: first ERROR", async () => {
    const r = await evalConditionOnText("ok\ninfo\nERROR boom\nmore\n", {
      mode: "until",
      expr: '"ERROR" in line',
    });
    expect(r.ok).toBe(true);
    expect(r.matched).toBe(1);
    expect(r.hits?.[0]?.text).toContain("ERROR");
  });

  it("rejects unsafe expr", async () => {
    const r = await evalConditionOnText("x\n", {
      mode: "filter",
      expr: "__import__('os').system('id')",
    });
    expect(r.ok).toBe(false);
  });
});
