import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PERF_THRESHOLDS,
  classifyOccupancy,
  classifyProfile,
  perfLogMode,
  shouldWritePerfLog,
} from "./perf-occupancy.js";
import {
  notePerfMark,
  resetPerfLogForTest,
  resolvePerfLogPath,
  writePerfLog,
} from "./perf-log.js";

const roots: string[] = [];

afterEach(() => {
  resetPerfLogForTest();
  delete process.env.MAOU_PERF_LOG;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "maou-perf-"));
  roots.push(root);
  mkdirSync(join(root, "logs", "perf"), { recursive: true });
  return root;
}

describe("classifyOccupancy", () => {
  it("stays cold under every threshold", () => {
    expect(
      classifyOccupancy({
        cpuPct: PERF_THRESHOLDS.cpuPct - 1,
        rssMb: PERF_THRESHOLDS.rssMb - 1,
        heapMb: PERF_THRESHOLDS.heapMb - 1,
        loopLagMs: PERF_THRESHOLDS.loopLagMs - 1,
        fps: PERF_THRESHOLDS.fps,
        longtaskMs: PERF_THRESHOLDS.longtaskMs - 1,
      }),
    ).toEqual([]);
  });

  it("names each hot reason", () => {
    expect(classifyOccupancy({ loopLagMs: 50 })).toEqual(["loopLag"]);
    expect(classifyOccupancy({ cpuPct: 80 })).toEqual(["cpu"]);
    expect(classifyOccupancy({ rssMb: 1500 })).toEqual(["rss"]);
    expect(classifyOccupancy({ heapMb: 800 })).toEqual(["heap"]);
    expect(classifyOccupancy({ fps: 19 })).toEqual(["fps"]);
    expect(classifyOccupancy({ longtaskMs: 50 })).toEqual(["longtask"]);
  });
});

describe("shouldWritePerfLog", () => {
  it("honors MAOU_PERF_LOG=0 / 1 / default", () => {
    expect(perfLogMode("0")).toBe("off");
    expect(perfLogMode("1")).toBe("force");
    expect(perfLogMode(undefined)).toBe("hot");
    expect(shouldWritePerfLog({ env: "0", snap: { cpuPct: 99 } }).write).toBe(false);
    expect(shouldWritePerfLog({ env: "1", snap: { cpuPct: 1 } }).write).toBe(true);
    expect(shouldWritePerfLog({ env: "", snap: { cpuPct: 1 } }).write).toBe(false);
    expect(shouldWritePerfLog({ env: "", snap: { loopLagMs: 80 } }).write).toBe(true);
  });

  it("writes on slow profile or mark", () => {
    expect(classifyProfile({ totalMs: 8000, maxSpanMs: 10 })).toBe(true);
    expect(classifyProfile({ totalMs: 10, maxSpanMs: 2000 })).toBe(true);
    expect(classifyProfile({ totalMs: 10, maxSpanMs: 10 })).toBe(false);
    expect(shouldWritePerfLog({ env: "", marks: [{ name: "hub.listSessions", durationMs: 80 }] }).write).toBe(true);
    expect(shouldWritePerfLog({ env: "", marks: [{ name: "hub.listSessions", durationMs: 20 }] }).write).toBe(false);
  });
});

describe("writePerfLog env off", () => {
  it("does not write when MAOU_PERF_LOG=0 even if forced", async () => {
    const root = tmpRoot();
    const now = Date.parse("2026-09-14T06:00:00.000Z");
    await writePerfLog(
      { kind: "occupancy", snap: { cpuPct: 99 } },
      { maouRoot: root, now, env: "0", force: true },
    );
    const file = resolvePerfLogPath(root, new Date(now));
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});

describe("writePerfLog", () => {
  it("writes a hot snapshot and skips a cold one", async () => {
    const root = tmpRoot();
    const now = Date.parse("2026-09-14T06:00:00.000Z");
    await writePerfLog(
      { kind: "occupancy", snap: { cpuPct: 12, loopLagMs: 4 } },
      { maouRoot: root, now, env: "" },
    );
    const file = resolvePerfLogPath(root, new Date(now));
    expect(() => readFileSync(file, "utf8")).toThrow();

    await writePerfLog(
      { kind: "occupancy", snap: { cpuPct: 91, loopLagMs: 4, rssMb: 200 } },
      { maouRoot: root, now, env: "" },
    );
    const text = readFileSync(file, "utf8");
    const row = JSON.parse(text.trim()) as { reasons: string[]; cpuPct: number };
    expect(row.reasons).toContain("cpu");
    expect(row.cpuPct).toBe(91);
  });

  it("attaches recent slow marks", async () => {
    const root = tmpRoot();
    const now = Date.parse("2026-09-14T06:00:00.000Z");
    notePerfMark("hub.listSessions", 120);
    await writePerfLog(
      { kind: "occupancy", snap: { cpuPct: 12 } },
      { maouRoot: root, now, env: "" },
    );
    const file = resolvePerfLogPath(root, new Date(now));
    const row = JSON.parse(readFileSync(file, "utf8").trim()) as {
      reasons: string[];
      marks: Array<{ name: string }>;
    };
    expect(row.reasons).toContain("mark");
    expect(row.marks[0]?.name).toBe("hub.listSessions");
  });
});
