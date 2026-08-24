import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";
import { GoalError } from "@little-house-studio/types";
import { appendLedgerEvent } from "./session-ledger.js";
import { SessionGoalService, renderGoalRoundPrompt } from "./session-goal.js";

describe("session goal", () => {
  const dirs: string[] = [];
  let service: SessionGoalService;

  beforeEach(() => {
    service = new SessionGoalService();
  });

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function session() {
    const dir = mkdtempSync(join(tmpdir(), "maou-goal-"));
    dirs.push(dir);
    const store = new SessionStore(dir);
    const created = store.create({ title: "g" });
    return { dir, id: created.id };
  }

  it("creates one armed active goal and persists across a fresh service", () => {
    const { dir, id } = session();
    const created = service.create(dir, id, { objective: "Ship the goal alignment" });
    expect(created.phase).toBe("active");
    expect(created.activation).toBe("armed");
    expect(created.revision).toBe(1);
    expect(created.roundsStarted).toBe(0);
    expect(created.maxGoalRounds).toBe(256);

    const replayed = new SessionGoalService().get(dir, id);
    expect(replayed?.objective).toBe("Ship the goal alignment");
    expect(replayed?.phase).toBe("active");
    expect(replayed?.activation).toBe("disarmed");
  });

  it("rejects a second create until the current goal is complete or cleared", () => {
    const { dir, id } = session();
    service.create(dir, id, { objective: "first" });
    expect(() => service.create(dir, id, { objective: "second" })).toThrow(GoalError);
    const current = service.get(dir, id)!;
    service.clear(dir, id, { id: current.id, revision: current.revision });
    const next = service.create(dir, id, { objective: "second" });
    expect(next.objective).toBe("second");
    expect(next.id).not.toBe(current.id);
  });

  it("pause / resume / complete and compare-and-set", () => {
    const { dir, id } = session();
    const created = service.create(dir, id, { objective: "keep going" });
    const paused = service.pause(dir, id, { id: created.id, revision: created.revision });
    expect(paused.phase).toBe("paused");
    expect(paused.activation).toBe("disarmed");
    expect(() => service.pause(dir, id, { id: created.id, revision: created.revision })).toThrow(GoalError);
    const resumed = service.resume(dir, id, { id: paused.id, revision: paused.revision });
    expect(resumed.phase).toBe("active");
    expect(resumed.activation).toBe("armed");
    const done = service.complete(dir, id, { id: resumed.id, revision: resumed.revision });
    expect(done.phase).toBe("complete");
    expect(done.activation).toBe("disarmed");
  });

  it("increments rounds only from a goal-sourced user/message", () => {
    const { dir, id } = session();
    const created = service.create(dir, id, { objective: "round test" });
    const wrote = appendLedgerEvent(dir, id, "user/message", {
      role: "user",
      content: "<goal_round>",
      source: "goal",
      goalSource: { kind: "goal", goalId: created.id, revision: created.revision, round: 1 },
    });
    expect("seq" in wrote).toBe(true);
    const after = service.get(dir, id);
    expect(after?.roundsStarted).toBe(1);
  });

  it("renderGoalRoundPrompt announces goal mode and optional progress", () => {
    const { dir, id } = session();
    const created = service.create(dir, id, { objective: "ship it" });
    const first = renderGoalRoundPrompt(created, 1);
    expect(first).toContain("goal 目标模式");
    expect(first).toContain("<task_completion>");
    expect(first).not.toContain("100%");
    const next = renderGoalRoundPrompt(created, 2, { progressPercent: 42 });
    expect(next).toContain("当前进度为 42%");
    expect(next).not.toContain("达到 100");
    const summary = renderGoalRoundPrompt(created, 3, { kind: "summary" });
    expect(summary).toContain("列点总结");
    expect(summary).not.toContain("99.8");
    const forced = renderGoalRoundPrompt(created, 22, { kind: "forced-close" });
    expect(forced).toContain("直接收尾");
  });
});
