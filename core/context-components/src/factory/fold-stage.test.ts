import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyFoldStage,
  applyLlmMajorCompress,
  foldUnfoldedSpan,
  isFoldArtifact,
  resolveTraditionalMajorScheme,
  type MaouMessage,
} from "../index.js";

function msg(
  seqId: number,
  category: MaouMessage["category"],
  text: string,
  extra?: Partial<MaouMessage>,
): MaouMessage {
  return {
    seqId,
    taskIds: [],
    contents: [{ text }],
    keepAfterCompress: false,
    category,
    ...extra,
  };
}

function bulk(n: number, chars = 400): MaouMessage[] {
  return Array.from({ length: n }, (_, i) =>
    msg(i, i % 2 === 0 ? "user" : "assistant", `${i} ${"x".repeat(chars)}`),
  );
}

describe("fold stage", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("folds unfolded messages outside the retain tail without calling the summarizer", async () => {
    let calls = 0;
    const history = bulk(20);
    const r = await applyFoldStage(history, {
      occupancy: 80_000,
      window: 100_000,
      retainCount: 4,
      summarizer: async () => {
        calls++;
        return "should-not-run";
      },
    });
    expect(r.changed).toBe(true);
    expect(r.stage).toBe("summary");
    expect(calls).toBe(0);
    const tail = r.history[r.history.length - 1]!;
    expect(tail.contents[0]!.text).toContain("19 ");
    expect(r.history.some(isFoldArtifact)).toBe(true);
    expect(r.history.length).toBeLessThan(history.length);
    expect(r.history.find((m) => m.seqId === 0)?.category).toBe("compact");
  });

  it("keeps already folded cards and only folds new unfolded spans", async () => {
    const first = foldUnfoldedSpan(bulk(20), 4);
    expect(first.changed).toBe(true);
    const grown = [
      ...first.history,
      msg(20, "user", "new-a " + "y".repeat(200)),
      msg(21, "assistant", "new-b " + "y".repeat(200)),
      msg(22, "user", "new-c " + "y".repeat(200)),
      msg(23, "assistant", "new-d " + "y".repeat(200)),
      msg(24, "user", "TAIL_KEEP"),
    ];
    const second = foldUnfoldedSpan(grown, 3);
    expect(second.changed).toBe(true);
    const folds = second.history.filter(isFoldArtifact);
    expect(folds.length).toBeGreaterThanOrEqual(2);
    expect(second.history.some((m) => m.contents[0]?.text.includes("TAIL_KEEP"))).toBe(true);
  });

  it("archives when the folded region exceeds the configured share", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-fold-"));
    dirs.push(dir);
    let calls = 0;
    const history = bulk(12, 800);
    const r = await applyFoldStage(history, {
      occupancy: 80_000,
      window: 100_000,
      retainCount: 2,
      sessionRoot: dir,
      config: { archiveFoldedPercent: 0 },
      summarizer: async () => {
        calls++;
        return "## Primary Request\n- demo";
      },
    });
    expect(r.stage).toBe("archive");
    expect(calls).toBe(1);
    expect(r.archivePath).toBeTruthy();
    expect(r.history.some((m) => m.compact?.type === "archive")).toBe(true);
    const raw = readFileSync(r.archivePath!, "utf-8");
    expect(raw).toContain("Primary Request");
    expect(raw).toContain("entries");
  });

  it("stays idle below the trigger", async () => {
    const r = await applyFoldStage(bulk(20), {
      occupancy: 10_000,
      window: 100_000,
    });
    expect(r.changed).toBe(false);
    expect(r.stage).toBe("none");
  });

  it("can be turned off", async () => {
    const r = await applyFoldStage(bulk(20), {
      occupancy: 90_000,
      window: 100_000,
      config: false,
    });
    expect(r.changed).toBe(false);
  });
});

describe("llm major compress", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("resolves fold by default and llm aliases to llm", () => {
    expect(resolveTraditionalMajorScheme()).toBe("fold");
    expect(resolveTraditionalMajorScheme("fold")).toBe("fold");
    expect(resolveTraditionalMajorScheme("llm")).toBe("llm");
    expect(resolveTraditionalMajorScheme("summarize")).toBe("llm");
    expect(resolveTraditionalMajorScheme("direct")).toBe("llm");
    expect(resolveTraditionalMajorScheme(undefined, false)).toBe("llm");
  });

  it("summarizes at the 80% threshold and writes the archive lookup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-llm-major-"));
    dirs.push(dir);
    let calls = 0;
    const history = bulk(20);
    const r = await applyLlmMajorCompress(history, {
      occupancy: 80_000,
      window: 100_000,
      retainCount: 4,
      sessionRoot: dir,
      summarizer: async () => {
        calls++;
        return "## Primary Request\n- llm-major";
      },
    });
    expect(r.changed).toBe(true);
    expect(r.stage).toBe("archive");
    expect(calls).toBe(1);
    expect(r.archivePath).toBeTruthy();
    expect(r.history.some((m) => m.compact?.type === "archive")).toBe(true);
    expect(r.history.some((m) => m.compact?.type === "fold")).toBe(false);
    const raw = readFileSync(r.archivePath!, "utf-8");
    expect(raw).toContain("llm-major");
    expect(raw).toContain("entries");
    expect(r.history[r.history.length - 1]!.contents[0]!.text).toContain("19 ");
  });

  it("stays idle below the trigger", async () => {
    let calls = 0;
    const r = await applyLlmMajorCompress(bulk(20), {
      occupancy: 10_000,
      window: 100_000,
      summarizer: async () => {
        calls++;
        return "should-not-run";
      },
    });
    expect(r.changed).toBe(false);
    expect(calls).toBe(0);
  });
});
