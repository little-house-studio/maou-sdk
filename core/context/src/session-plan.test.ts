import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionPlan, sessionPlanFile, renderPlanPolicy } from "./session-plan.js";

describe("session plan sidecar", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function session() {
    const dir = mkdtempSync(join(tmpdir(), "maou-plan-"));
    dirs.push(dir);
    return { dir, id: "sess-plan" };
  }

  it("enters, writes a heading plan, and approves", () => {
    const { dir, id } = session();
    const entered = sessionPlan.enter(dir, id, "Ship the login");
    expect(entered.active).toBe(true);
    expect(entered.status).toBe("planning");
    expect(() => sessionPlan.writePlan(dir, id, "no heading")).toThrow(/# heading/);
    const written = sessionPlan.writePlan(dir, id, "# Plan\n\n## Steps\n- do it");
    expect(written.status).toBe("review");
    expect(written.planReady).toBe(true);
    expect(existsSync(sessionPlanFile(dir, id))).toBe(true);
    const approved = sessionPlan.approve(dir, id);
    expect(approved?.active).toBe(false);
    expect(approved?.status).toBe("approved");
    expect(sessionPlan.isActive(dir, id)).toBe(false);
  });

  it("off keeps the file; clear removes it", () => {
    const { dir, id } = session();
    sessionPlan.enter(dir, id, "X");
    sessionPlan.writePlan(dir, id, "# Plan\nbody");
    sessionPlan.off(dir, id);
    expect(sessionPlan.readPlan(dir, id)).toContain("# Plan");
    expect(sessionPlan.clear(dir, id)).toBe(true);
    expect(sessionPlan.get(dir, id)).toBeUndefined();
  });

  it("policy is a no-edit instruction", () => {
    expect(renderPlanPolicy("/tmp/plan.md", "Ship")).toBe("当前是 plan 计划阶段，不要编辑文件。");
  });
});
