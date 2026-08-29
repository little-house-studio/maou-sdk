import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactFailHuman } from "./command-registry.js";
import { classifyCompactError } from "./runtime.js";

const COMPACT_CODES = [
  "busy",
  "content_changed",
  "summary_failed",
  "commit_failed",
  "not_written",
  "no_range",
] as const;

describe("classifyCompactError", () => {
  it("maps human codes", () => {
    expect(classifyCompactError("正忙：当前会话还在跑")).toBe("busy");
    expect(classifyCompactError("content changed / generation")).toBe("content_changed");
    expect(classifyCompactError("摘要失败")).toBe("summary_failed");
    expect(classifyCompactError("commit failed")).toBe("commit_failed");
    expect(classifyCompactError("ENOSPC disk write")).toBe("not_written");
    expect(classifyCompactError("no_range 无可压")).toBe("no_range");
  });
});

describe("compactFailHuman", () => {
  it("gives a distinct human line for every code", () => {
    const seen = new Set<string>();
    for (const code of COMPACT_CODES) {
      const line = compactFailHuman(code);
      expect(line).toBeTruthy();
      expect(line).not.toBe("未知原因");
      expect(seen.has(line)).toBe(false);
      seen.add(line);
    }
  });

  it("falls back to the raw error, never to an empty string", () => {
    expect(compactFailHuman(undefined, "raw detail")).toBe("raw detail");
    expect(compactFailHuman("no_such_code", "  ")).toBe("未知原因");
  });

  it("busy says the session is running, not that compaction failed", () => {
    expect(compactFailHuman("busy")).toContain("正忙");
  });
});

describe("compaction bookkeeping funnel", () => {
  // clearLastOccupancy 是压缩后记账的唯一漏斗（清占用锚点 + 说明书基线作废）。
  // 任何新增的压缩路径漏掉它，占用条不会变短、AGENTS 基线也不会重组。
  const src = readFileSync(new URL("./runtime.ts", import.meta.url), "utf-8");

  it("clearLastOccupancy invalidates the instruction baseline", () => {
    const body = src.slice(src.indexOf("private clearLastOccupancy"));
    const end = body.indexOf("\n  }");
    expect(body.slice(0, end)).toContain("this.instructionRebaseline.add(sessionId)");
  });

  it("every method that compresses also clears the occupancy anchor", () => {
    // 按类成员边界切块：压缩调用与 clearLastOccupancy 必须落在同一个方法里。
    const memberStart = /\n {2}(?:private |public |protected )?(?:static )?(?:async )?\*?[A-Za-z_]\w*[(<]/g;
    const bounds: number[] = [];
    for (let m = memberStart.exec(src); m; m = memberStart.exec(src)) {
      bounds.push(m.index);
    }
    expect(bounds.length).toBeGreaterThan(20);

    const chunks = bounds.map((start, i) => src.slice(start, bounds[i + 1] ?? src.length));
    const sites = ["engine.compress(", "maybeCompress(", "forceCompressSession("];
    let checked = 0;
    for (const chunk of chunks) {
      const compresses = sites.some((s) => chunk.includes(s));
      if (!compresses) continue;
      // 定义处/透传处不算：只看真的走了压缩且能拿到 sessionId 的方法
      if (!chunk.includes("sessionId")) continue;
      checked++;
      expect(chunk).toContain("clearLastOccupancy");
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
