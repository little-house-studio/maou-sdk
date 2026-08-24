import { describe, expect, it } from "vitest";
import {
  decideGoalSettle,
  goalRoundPromptKind,
  isGoalTaskFinished,
  parseTaskCompletion,
  stripTaskCompletionMarkup,
} from "./task-completion.js";

describe("parseTaskCompletion", () => {
  it("reads the last percent or failed tag, including decimals", () => {
    expect(parseTaskCompletion("done <task_completion>40%</task_completion>")).toEqual({
      kind: "percent",
      percent: 40,
    });
    expect(parseTaskCompletion("<task_completion> 99.8% </task_completion>")).toEqual({
      kind: "percent",
      percent: 99.8,
    });
    expect(parseTaskCompletion("<task_completion>99.80</task_completion>")).toEqual({
      kind: "percent",
      percent: 99.8,
    });
    expect(parseTaskCompletion("<task_completion>100%</task_completion>")).toEqual({
      kind: "percent",
      percent: 100,
    });
    expect(parseTaskCompletion("a <task_completion>10%</task_completion>\nb <task_completion>FAILED</task_completion>")).toEqual({
      kind: "failed",
    });
    expect(parseTaskCompletion("no tag")).toEqual({ kind: "none" });
    expect(parseTaskCompletion("<task_completion>almost</task_completion>")).toEqual({ kind: "none" });
  });
});

describe("stripTaskCompletionMarkup", () => {
  it("removes complete tags and hides a streaming prefix", () => {
    expect(stripTaskCompletionMarkup("hello <task_completion>80%</task_completion>")).toBe("hello ");
    expect(stripTaskCompletionMarkup("hello <task_comple")).toBe("hello ");
    expect(stripTaskCompletionMarkup("hello <task_completion>40")).toBe("hello ");
    expect(stripTaskCompletionMarkup("plain")).toBe("plain");
  });
});

describe("isGoalTaskFinished", () => {
  it("treats 99.8% or above, or failed, as finished", () => {
    expect(isGoalTaskFinished({ kind: "percent", percent: 99.8 })).toBe(true);
    expect(isGoalTaskFinished({ kind: "percent", percent: 99.81 })).toBe(true);
    expect(isGoalTaskFinished({ kind: "percent", percent: 100 })).toBe(true);
    expect(isGoalTaskFinished({ kind: "failed" })).toBe(true);
    expect(isGoalTaskFinished({ kind: "percent", percent: 99.79 })).toBe(false);
    expect(isGoalTaskFinished({ kind: "none" })).toBe(false);
  });
});

describe("decideGoalSettle", () => {
  it("defers complete/failed until after a summary round", () => {
    const first = decideGoalSettle({
      report: { kind: "percent", percent: 99.8 },
      kickbacks: 3,
      countKickback: true,
    });
    expect(first.apply).toBeUndefined();
    expect(first.pending).toEqual({ outcome: "complete", reason: "reported" });
    expect(goalRoundPromptKind(first.pending)).toBe("summary");

    const afterSummary = decideGoalSettle({
      pending: first.pending,
      report: { kind: "none" },
      kickbacks: 3,
      countKickback: true,
    });
    expect(afterSummary.apply).toEqual({ outcome: "complete", reason: "reported" });
  });

  it("forces a close after more than 20 kickbacks", () => {
    const mid = decideGoalSettle({
      report: { kind: "percent", percent: 40 },
      kickbacks: 20,
      countKickback: true,
    });
    expect(mid.kickbacks).toBe(21);
    expect(mid.pending).toEqual({ outcome: "complete", reason: "kickback" });
    expect(goalRoundPromptKind(mid.pending)).toBe("forced-close");

    const stillGoing = decideGoalSettle({
      report: { kind: "percent", percent: 40 },
      kickbacks: 19,
      countKickback: true,
    });
    expect(stillGoing.pending).toBeUndefined();
    expect(stillGoing.kickbacks).toBe(20);
  });

  it("does not count a kickback on the opening command turn", () => {
    const opened = decideGoalSettle({
      report: { kind: "none" },
      kickbacks: 0,
      countKickback: false,
    });
    expect(opened.kickbacks).toBe(0);
    expect(opened.pending).toBeUndefined();
  });
});
