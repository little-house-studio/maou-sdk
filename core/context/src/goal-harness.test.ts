import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  firstUncheckedPlanItem,
  gapFingerprint,
  goalHarness,
  planPath,
  renderPlanMarkdown,
} from "./goal-harness.js";

describe("goal harness sidecar", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    goalHarness.resetForTests();
  });

  afterEach(() => {
    goalHarness.resetForTests();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function session() {
    const dir = mkdtempSync(join(tmpdir(), "maou-harness-"));
    dirs.push(dir);
    return { dir, id: "sess-1" };
  }

  it("creates an active goal and writes sidecar state", () => {
    const { dir, id } = session();
    const created = goalHarness.create(dir, id, "Ship the contract", 4000);
    expect(created.status).toBe("active");
    expect(created.phase).toBe("planning");
    expect(created.planReady).toBe(false);
    expect(created.tokenBudget).toBe(4000);
    expect(goalHarness.isOpen(dir, id)).toBe(true);
    expect(goalHarness.isActive(dir, id)).toBe(true);
    expect(existsSync(join(dir, `${id}.goal`, "state.json"))).toBe(true);
  });

  it("reconciles disk-active to user_paused after process restart", () => {
    const { dir, id } = session();
    goalHarness.create(dir, id, "Survive restart");
    expect(goalHarness.isActive(dir, id)).toBe(true);
    goalHarness.resetForTests();
    const restored = goalHarness.get(dir, id);
    expect(restored?.status).toBe("user_paused");
    expect(goalHarness.isActive(dir, id)).toBe(false);
    expect(goalHarness.isOpen(dir, id)).toBe(true);
  });

  it("resume after restart marks the id live again", () => {
    const { dir, id } = session();
    goalHarness.create(dir, id, "Resume me");
    goalHarness.resetForTests();
    expect(goalHarness.get(dir, id)?.status).toBe("user_paused");
    const resumed = goalHarness.resume(dir, id);
    expect(resumed?.status).toBe("active");
    expect(goalHarness.isActive(dir, id)).toBe(true);
  });

  it("complete and clear close the slot", () => {
    const { dir, id } = session();
    goalHarness.create(dir, id, "Finish it");
    goalHarness.complete(dir, id);
    expect(goalHarness.get(dir, id)?.status).toBe("complete");
    expect(goalHarness.isOpen(dir, id)).toBe(false);
    expect(goalHarness.clear(dir, id)).toBe(true);
    expect(goalHarness.get(dir, id)).toBeUndefined();
  });

  it("stalls after the same gap fingerprint repeats", () => {
    const { dir, id } = session();
    goalHarness.create(dir, id, "Converge");
    const fp = gapFingerprint(["missing test"]);
    const first = goalHarness.recordNotAchieved(dir, id, "missing test", fp);
    expect(first.stalled).toBe(false);
    const second = goalHarness.recordNotAchieved(dir, id, "missing test", fp);
    expect(second.stalled).toBe(true);
  });

  it("picks the first unchecked checklist item", () => {
    const markdown = renderPlanMarkdown({
      headline: "Do the work",
      kind: "code-change",
      criteria: ["done"],
      verification: [{ tag: "gating", step: "run tests" }],
      nonGoals: [],
      assumedScope: "src",
      checklist: ["Read the file", "Change it"],
    });
    expect(firstUncheckedPlanItem(markdown)).toBe("Read the file");
    expect(planPath("/tmp", "x")).toContain("x.goal");
  });
});
