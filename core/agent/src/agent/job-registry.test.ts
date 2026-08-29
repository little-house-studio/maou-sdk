import { afterEach, describe, expect, it } from "vitest";
import {
  completeJob,
  DEFAULT_WAKE_STREAK_LIMIT,
  jobLamp,
  noteAutoWake,
  registerJob,
  resetJobRegistryForTest,
  resetWakeStreak,
  takeSettledJobs,
} from "./job-registry.js";

afterEach(() => {
  resetJobRegistryForTest();
});

describe("job-registry", () => {
  it("settles FIFO per session", () => {
    registerJob("a", "j1");
    registerJob("a", "j2");
    registerJob("b", "j1");
    completeJob("a", "j2", "done");
    completeJob("a", "j1", "failed");
    const ready = takeSettledJobs("a");
    expect(ready.map((j) => j.id)).toEqual(["j1", "j2"]);
    expect(takeSettledJobs("b")).toEqual([]);
  });

  it("stops auto-wake after the streak limit", () => {
    expect(noteAutoWake("s").allowed).toBe(true);
    expect(noteAutoWake("s").allowed).toBe(true);
    expect(noteAutoWake("s").allowed).toBe(true);
    const fourth = noteAutoWake("s");
    expect(fourth.allowed).toBe(false);
    expect(fourth.streak).toBe(DEFAULT_WAKE_STREAK_LIMIT + 1);
    resetWakeStreak("s");
    expect(noteAutoWake("s").allowed).toBe(true);
  });

  it("counts lamp states", () => {
    registerJob("s", "r");
    completeJob("s", "x", "done");
    registerJob("s", "x", { status: "done" });
    const lamp = jobLamp("s");
    expect(lamp.running).toBe(1);
    expect(lamp.done).toBeGreaterThanOrEqual(1);
  });
});
