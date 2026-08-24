import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goalHarness, planPath } from "@little-house-studio/context";
import {
  aggregateVerifiers,
  decideHarnessRound,
  parseEvaluatorJson,
  parsePlannerJson,
  parseVerifierJson,
  planHarnessGoal,
  type HarnessAux,
} from "./harness-loop.js";

function auxWith(queue: Array<Record<string, unknown> | null>): HarnessAux {
  return {
    async callJson() {
      const json = queue.shift() ?? null;
      return { ok: Boolean(json), json, content: json ? JSON.stringify(json) : "" };
    },
    async callText() {
      return { ok: true, content: "Verified complete. Use the shipped change." };
    },
  };
}

const PLANNER_OK = {
  headline: "Ship the contract",
  kind: "code-change",
  criteria: ["file exists", "tests pass"],
  verification: [{ tag: "gating", step: "run the unit tests" }],
  nonGoals: ["rewrite the runtime"],
  assumedScope: "src/",
  checklist: ["Inspect", "Implement"],
};

describe("harness-loop parsers", () => {
  it("rejects planner json without criteria or verification", () => {
    expect(parsePlannerJson({ headline: "x", criteria: [], verification: [] })).toBeUndefined();
    expect(parsePlannerJson(PLANNER_OK)?.startsWith("# Plan:")).toBe(true);
  });

  it("requires a snake_case blocker only for blocked", () => {
    expect(
      parseEvaluatorJson({
        decision: "continue",
        evidence: "more work",
        next_step: "write tests",
      }),
    ).toMatchObject({ decision: "continue", blockerKey: "" });
    expect(
      parseEvaluatorJson({
        decision: "blocked",
        evidence: "need secret",
        next_step: "ask the user",
        blocker_key: "need_secret",
      })?.blockerKey,
    ).toBe("need_secret");
    expect(
      parseEvaluatorJson({
        decision: "continue",
        evidence: "more work",
        next_step: "write tests",
        blocker_key: "oops",
      }),
    ).toBeUndefined();
  });

  it("defaults uncertain verifiers to refuted", () => {
    expect(parseVerifierJson({})?.refuted).toBe(true);
    expect(parseVerifierJson({ refuted: false, evidence: "ok" })?.refuted).toBe(false);
  });

  it("lets seat 0 high-confidence refute veto the panel", () => {
    const veto = aggregateVerifiers([
      {
        refuted: true,
        findings: [{ kind: "gap", location: "test", detail: "no test" }],
        evidence: "missing",
        confidence: "high",
        blocking: "none",
      },
      {
        refuted: false,
        findings: [],
        evidence: "looks fine",
        confidence: "high",
        blocking: "none",
      },
    ]);
    expect(veto.achieved).toBe(false);

    const pass = aggregateVerifiers([
      {
        refuted: false,
        findings: [],
        evidence: "ok",
        confidence: "high",
        blocking: "none",
      },
      {
        refuted: false,
        findings: [],
        evidence: "ok",
        confidence: "medium",
        blocking: "none",
      },
    ]);
    expect(pass.achieved).toBe(true);
  });
});

describe("planHarnessGoal / decideHarnessRound", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    goalHarness.resetForTests();
  });

  afterEach(() => {
    goalHarness.resetForTests();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function session() {
    const dir = mkdtempSync(join(tmpdir(), "maou-hloop-"));
    dirs.push(dir);
    const id = "sess-loop";
    goalHarness.create(dir, id, "Ship the alignment");
    return { dir, id };
  }

  it("pauses when planning has no aux", async () => {
    const { dir, id } = session();
    const result = await planHarnessGoal({ sessionDir: dir, sessionId: id, preset: {} });
    expect(result.ok).toBe(false);
    expect(goalHarness.get(dir, id)?.status).toBe("infra_paused");
  });

  it("writes plan.md on a valid planner verdict", async () => {
    const { dir, id } = session();
    const result = await planHarnessGoal({
      sessionDir: dir,
      sessionId: id,
      preset: {},
      aux: auxWith([PLANNER_OK]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.prompt).toContain("Start now");
    expect(existsSync(planPath(dir, id))).toBe(true);
    expect(readFileSync(planPath(dir, id), "utf-8")).toContain("Acceptance criteria");
    expect(goalHarness.get(dir, id)?.planReady).toBe(true);
  });

  it("continues on evaluator continue and completes when both verifiers pass", async () => {
    const { dir, id } = session();
    await planHarnessGoal({
      sessionDir: dir,
      sessionId: id,
      preset: {},
      aux: auxWith([PLANNER_OK]),
    });

    const cont = await decideHarnessRound({
      sessionDir: dir,
      sessionId: id,
      lastAssistant: "still working",
      tokensDelta: 10,
      cwd: dir,
      preset: {},
      queuedUser: false,
      aux: auxWith([
        { decision: "continue", evidence: "tests missing", next_step: "add a test" },
      ]),
    });
    expect(cont.action).toBe("continue");

    const done = await decideHarnessRound({
      sessionDir: dir,
      sessionId: id,
      lastAssistant: "shipped and tested",
      tokensDelta: 10,
      cwd: dir,
      preset: {},
      queuedUser: false,
      aux: auxWith([
        { decision: "candidate_complete", evidence: "all criteria hold", next_step: "verify" },
        { refuted: false, findings: [], evidence: "ok", confidence: "high", blocking: "none" },
        { refuted: false, findings: [], evidence: "ok", confidence: "high", blocking: "none" },
      ]),
    });
    expect(done.action).toBe("complete");
    expect(goalHarness.get(dir, id)?.status).toBe("complete");
  });

  it("marks budget_limited when tokens exceed the cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-hloop-"));
    dirs.push(dir);
    const id = "sess-budget";
    goalHarness.create(dir, id, "Tiny budget", 5);
    const result = await decideHarnessRound({
      sessionDir: dir,
      sessionId: id,
      lastAssistant: "work",
      tokensDelta: 8,
      cwd: dir,
      preset: {},
      queuedUser: false,
      aux: auxWith([]),
    });
    expect(result.action).toBe("pause");
    expect(goalHarness.get(dir, id)?.status).toBe("budget_limited");
  });
});
