import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectDurableAppendFailure, isLedgerBarrier, ledgerPath } from "@little-house-studio/context";
import { AgentRuntime, ledgerBarrierHuman } from "./runtime.js";

const SID = "sess-barrier";

/** 只搭出 ledgerBarrier 依赖的那两个字段，不启动整个 runtime。 */
function barrierHarness(sessionDir: string): {
  barrier: (type: string) => { ok: true } | { ok: false; reason: string };
  note: (type: string) => void;
  logs: string[];
} {
  const logs: string[] = [];
  const rt = Object.create(AgentRuntime.prototype) as Record<string, unknown>;
  rt.sessions = { sessionDir };
  rt.logFn = (level: string, message: string) => logs.push(`${level} ${message}`);
  return {
    barrier: (type) =>
      (rt as { ledgerBarrier: (s: string, t: string, d: Record<string, unknown>) => never }).ledgerBarrier(
        SID,
        type,
        {},
      ),
    note: (type) =>
      (rt as { noteLedger: (s: string, t: string, d: Record<string, unknown>) => void }).noteLedger(SID, type, {}),
    logs,
  };
}

function ledgerText(sessionDir: string): string {
  const p = ledgerPath(sessionDir, SID);
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

describe("isLedgerBarrier", () => {
  it("covers the steps that spend money or change the world", () => {
    for (const t of ["turn/start", "model/request", "tool/dispatch", "compact/start", "compact/summary", "compact/end"]) {
      expect(isLedgerBarrier(t)).toBe(true);
    }
  });

  it("leaves ordinary bookkeeping outside the barrier", () => {
    for (const t of ["turn/end", "user/message", "assistant/message", "tool/result", "session/title", "todo/write"]) {
      expect(isLedgerBarrier(t)).toBe(false);
    }
  });
});

describe("AgentRuntime ledger barrier", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "maou-barrier-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes and lands the record on disk when the write succeeds", () => {
    const h = barrierHarness(dir);
    expect(h.barrier("model/request")).toEqual({ ok: true });
    expect(ledgerText(dir)).toContain("model/request");
  });

  it("reports a readable reason and leaves no half record when the write fails", () => {
    const h = barrierHarness(dir);
    injectDurableAppendFailure();
    const res = h.barrier("model/request");
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.reason).toMatch(/injected durable append fail/);
    expect(ledgerText(dir)).not.toContain("model/request");
    expect(h.logs.join("\n")).toContain("未落盘");
  });

  it("still swallows non-barrier events so bookkeeping never breaks the turn", () => {
    const h = barrierHarness(dir);
    injectDurableAppendFailure();
    expect(() => h.note("session/title")).not.toThrow();
  });

  it("throws out of noteLedger for barrier types so callers cannot ignore it", () => {
    const h = barrierHarness(dir);
    injectDurableAppendFailure();
    expect(() => h.note("tool/dispatch")).toThrow(/injected durable append fail/);
  });
});

describe("ledgerBarrierHuman", () => {
  it("names what was skipped and what to fix", () => {
    const line = ledgerBarrierHuman("tool/dispatch", "ENOSPC");
    expect(line).toContain("不动手");
    expect(line).toContain("ENOSPC");
    expect(line).toMatch(/磁盘/);
    expect(ledgerBarrierHuman("model/request", "EACCES")).toContain("不开口");
  });
});

describe("barrier call sites", () => {
  const src = readFileSync(new URL("./runtime.ts", import.meta.url), "utf-8");

  it("gates the model call on the barrier, not just on hooks", () => {
    const i = src.indexOf('this.ledgerBarrier(sessionId, "model/request"');
    expect(i).toBeGreaterThan(0);
    const window = src.slice(i, i + 1200);
    expect(window).toContain("if (!barrier.ok)");
    expect(window).toContain('ledgerBarrierHuman("model/request"');
    // 屏障判断必须在真正发请求之前
    expect(src.indexOf("this.callModelFn({")).toBeGreaterThan(i);
  });

  it("turns a failed dispatch barrier into a blocked tool rather than a silent run", () => {
    const i = src.indexOf('this.ledgerBarrier(sessionId, "tool/dispatch"');
    expect(i).toBeGreaterThan(0);
    const window = src.slice(i, i + 800);
    expect(window).toContain("blocked = true");
    expect(window).toContain("barrierBlockReason");
    expect(src.indexOf("this.toolExecutor.executeSingle(")).toBeGreaterThan(i);
  });

  it("refuses to open a turn when turn/start cannot be persisted", () => {
    const i = src.indexOf('this.ledgerBarrier(sessionId, "turn/start"');
    expect(i).toBeGreaterThan(0);
    const window = src.slice(i, i + 700);
    expect(window).toContain("blocked: true");
    expect(window).toContain("return;");
  });
});
