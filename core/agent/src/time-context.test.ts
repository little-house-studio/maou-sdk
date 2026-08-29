import { describe, expect, it } from "vitest";
import {
  DynamicSnapshotGate,
  TimeContextGate,
  compileTimeSnapshot,
  detectMultiplexerPane,
  hostTimeZone,
} from "./time-context.js";

describe("DynamicSnapshotGate", () => {
  it("injects with a supersedes header the first time", () => {
    const gate = new DynamicSnapshotGate();
    const out = gate.consume("<terminals>vite (running)</terminals>");
    expect(out).toContain("<runtime_context>");
    expect(out).toContain("supersedes earlier runtime-context snapshots");
    expect(out).toContain("vite (running)");
  });

  it("stays quiet when the state has not changed", () => {
    const gate = new DynamicSnapshotGate();
    const body = "<terminals>vite (running)</terminals>";
    expect(gate.consume(body)).not.toBe("");
    expect(gate.consume(body)).toBe("");
    expect(gate.consume(`${body}\n`)).toBe("");
  });

  it("re-injects when the state changes", () => {
    const gate = new DynamicSnapshotGate();
    gate.consume("<terminals>a</terminals>");
    const second = gate.consume("<terminals>a, b</terminals>");
    expect(second).toContain("a, b");
    expect(second).toContain("supersedes");
  });

  it("says the old snapshot no longer applies once the state goes empty", () => {
    const gate = new DynamicSnapshotGate();
    gate.consume("<terminals>a</terminals>");
    const cleared = gate.consume("");
    expect(cleared).toContain("Current runtime context: none");
    expect(cleared).toContain("no longer apply");
    // 只说一次
    expect(gate.consume("")).toBe("");
  });

  it("never announces a clear before anything was injected", () => {
    expect(new DynamicSnapshotGate().consume("")).toBe("");
    expect(new DynamicSnapshotGate().consume("   ")).toBe("");
  });

  it("re-injects after reset (compression may have dropped the old snapshot)", () => {
    const gate = new DynamicSnapshotGate();
    const body = "<terminals>a</terminals>";
    gate.consume(body);
    expect(gate.consume(body)).toBe("");
    gate.reset();
    expect(gate.consume(body)).toContain("supersedes");
  });
});

describe("time-context", () => {
  it("is off by default", () => {
    const gate = new TimeContextGate({});
    expect(gate.enabled).toBe(false);
    expect(gate.consume()).toBe("");
  });

  it("emits once then respects interval / same text", () => {
    const now = new Date("2026-08-29T06:00:00Z");
    const gate = new TimeContextGate({ enabled: true, minIntervalMs: 60_000 });
    const first = gate.consume({ now, turn: 1, env: { TZ: "UTC" } });
    expect(first).toContain("<time_context>");
    expect(first).toContain("supersedes");
    expect(gate.consume({ now: new Date(now.getTime() + 10_000), turn: 1, env: { TZ: "UTC" } })).toBe(
      "",
    );
  });

  it("flags TZ vs host mismatch", () => {
    const { zone } = hostTimeZone({});
    const snap = compileTimeSnapshot({
      now: new Date("2026-08-29T06:00:00Z"),
      env: { TZ: zone === "UTC" ? "Asia/Shanghai" : "UTC" },
    });
    expect(snap.tzConflict).toBe(true);
    expect(snap.text).toMatch(/Ask the user which zone/i);
  });

  it("ignores leftover TMUX_PANE inside IDE", () => {
    expect(
      detectMultiplexerPane({
        TERM_PROGRAM: "vscode",
        TMUX: "/tmp/tmux-1000/default,123,0",
        TMUX_PANE: "%3",
      }),
    ).toBeNull();
    expect(
      detectMultiplexerPane({
        TERM_PROGRAM: "Cursor",
        TMUX_PANE: "%9",
      }),
    ).toBeNull();
  });

  it("accepts real tmux when pane matches session", () => {
    const hit = detectMultiplexerPane({
      TMUX: "/tmp/tmux-1000/default,1234,0",
      TMUX_PANE: "%2",
    });
    expect(hit).toEqual({ kind: "tmux", pane: "%2" });
  });

  it("uses queryTmux when provided", () => {
    const hit = detectMultiplexerPane(
      { TMUX: "/tmp/tmux-1000/default,1,0" },
      { queryTmux: () => "%7" },
    );
    expect(hit).toEqual({ kind: "tmux", pane: "%7" });
  });
});
