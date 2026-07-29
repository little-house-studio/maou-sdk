/**
 * Profiler 耗时聚合测试。
 * 跑：cd core/types && npx vitest run src/profiler.test.ts
 */
import { describe, it, expect } from "vitest";
import { Profiler } from "./profiler.js";

describe("Profiler.record", () => {
  it("外层耗时早于 profiler 起点时，startMs 钳到 0（不出现负时间线）", () => {
    const prof = new Profiler("t");
    // 一个比 profiler 存活时间长得多的 span（桥接 LLM 内部 timing 的真实情形）
    prof.record("llm_first_byte", 60_000);
    const r = prof.getRecords();
    expect(r).toHaveLength(1);
    expect(r[0]!.startMs).toBe(0);
    expect(r[0]!.durationMs).toBe(60_000);
  });

  it("拒绝负数 / NaN / Infinity，接受 0", () => {
    const prof = new Profiler("t");
    prof.record("neg", -1);
    prof.record("nan", Number.NaN);
    prof.record("inf", Number.POSITIVE_INFINITY);
    prof.record("zero", 0);
    expect(prof.getRecords().map((r) => r.name)).toEqual(["zero"]);
  });

  it("disabled 时不登记", () => {
    const prof = new Profiler("t", false);
    prof.record("x", 10);
    prof.start("y")();
    expect(prof.getRecords()).toHaveLength(0);
  });
});

describe("Profiler.report", () => {
  it("按名聚合 total/count/avg/max", () => {
    const prof = new Profiler("t");
    prof.record("tool:read", 100);
    prof.record("tool:read", 300);
    prof.record("tool:write", 50);
    const rep = prof.report();
    const read = rep.spans.find((s) => s.name === "tool:read")!;
    expect(read.count).toBe(2);
    expect(read.totalMs).toBe(400);
    expect(read.avgMs).toBe(200);
    expect(read.maxMs).toBe(300);
    // 降序：read(400) 在 write(50) 之前
    expect(rep.spans[0]!.name).toBe("tool:read");
  });

  it("span 名相同的记录不互相覆盖", () => {
    const prof = new Profiler("t");
    for (let i = 0; i < 5; i++) prof.record("s", 10);
    expect(prof.report().spans[0]!.count).toBe(5);
  });
});

describe("Profiler.renderText", () => {
  it("pct 超 100%（嵌套 span）时 bar 不撑爆表格", () => {
    const prof = new Profiler("t");
    // 单个 span 的耗时远超 profiler 墙钟 → pct 远大于 100
    prof.record("llm_call", 600_000);
    const text = prof.renderText();
    const barLine = text.split("\n").find((l) => l.includes("llm_call"))!;
    const bars = (barLine.match(/█/g) ?? []).length;
    expect(bars).toBeLessThanOrEqual(20);
    expect(barLine).toContain("»"); // 溢出标记
    // 整行长度可控，不会因为 pct=6000% 拉出上百格
    expect(barLine.length).toBeLessThan(120);
  });

  it("正常占比不带溢出标记", () => {
    const prof = new Profiler("t");
    const end = prof.start("quick");
    end();
    const line = prof.renderText().split("\n").find((l) => l.includes("quick"))!;
    expect(line).not.toContain("»");
  });

  it("首行含 label 与 span 数", () => {
    const prof = new Profiler("run:abc");
    prof.record("a", 1);
    prof.record("b", 2);
    const head = prof.renderText().split("\n")[0]!;
    expect(head).toContain("run:abc");
    expect(head).toContain("spans=2");
  });
});

describe("Profiler.start / sync / async", () => {
  it("end 重复调用只登记一次", () => {
    const prof = new Profiler("t");
    const end = prof.start("s");
    end();
    end();
    end();
    expect(prof.getRecords()).toHaveLength(1);
  });

  it("sync/async 抛错时仍登记耗时", async () => {
    const prof = new Profiler("t");
    expect(() => prof.sync("boom", () => { throw new Error("x"); })).toThrow();
    await expect(prof.async("aboom", async () => { throw new Error("y"); })).rejects.toThrow();
    expect(prof.getRecords().map((r) => r.name).sort()).toEqual(["aboom", "boom"]);
  });

  it("durationMs 非负", () => {
    const prof = new Profiler("t");
    prof.sync("s", () => 1);
    expect(prof.getRecords()[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });
});
