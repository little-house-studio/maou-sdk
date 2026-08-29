import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactSeqRange } from "./runtime.js";

describe("compactSeqRange", () => {
  it("passes the real interval through", () => {
    expect(compactSeqRange({ seqFrom: 3, seqTo: 17 })).toEqual({ seqFrom: 3, seqTo: 17 });
  });

  it("carries nothing rather than claiming 0..0 when nothing was dropped", () => {
    expect(compactSeqRange({})).toEqual({});
    expect(compactSeqRange({ seqFrom: 3 })).toEqual({});
    expect(compactSeqRange({ seqTo: 9 })).toEqual({});
  });
});

describe("compact surfaces carry seq, not token counts", () => {
  const src = readFileSync(new URL("./runtime.ts", import.meta.url), "utf-8");

  it("no longer writes originalTokens into surfaceOp", () => {
    expect(src).not.toContain('surfaceOp: { op: "replace", start: 0, end: report.originalTokens');
  });

  it("every surfaceOp comes from the compress report's seq range", () => {
    const hits = [...src.matchAll(/surfaceOp: \{[^}]*\}/g)].map((m) => m[0]);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) {
      expect(h).toContain("seqFrom");
      expect(h).toContain("seqTo");
    }
  });

  it("compact brackets ship the seq range so cold recovery can rewind", () => {
    // 两条压缩落点（手动 /compact 与自动/溢出）都要把区间写进账本
    const spread = [...src.matchAll(/\.\.\.(?:seqRange|range),/g)];
    expect(spread.length).toBeGreaterThanOrEqual(4);
  });
});
