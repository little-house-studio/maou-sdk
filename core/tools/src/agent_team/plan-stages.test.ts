import { describe, it, expect } from "vitest";
import { parsePlanStages, formatStageStatus } from "./plan-stages.js";

describe("parsePlanStages", () => {
  it("parses json:plan fence", () => {
    const plan = `
# Goal
Do stuff

\`\`\`json:plan
{
  "stages": [
    { "id": "s1", "title": "small", "check_command": "node a.mjs" },
    { "id": "s2", "check_command": "node b.mjs" }
  ]
}
\`\`\`
`;
    const r = parsePlanStages(plan);
    expect(r.stages).toHaveLength(2);
    expect(r.stages[0]!.id).toBe("s1");
    expect(r.stages[0]!.check_command).toBe("node a.mjs");
    expect(r.planBody).not.toContain("json:plan");
  });

  it("empty when no stages", () => {
    const r = parsePlanStages("just markdown");
    expect(r.stages).toHaveLength(0);
  });
});

describe("formatStageStatus", () => {
  it("marks current stage", () => {
    const s = formatStageStatus({
      stages: [
        { id: "a" },
        { id: "b" },
      ],
      currentStageIndex: 1,
      stageResults: [{ id: "a", pass: true }],
    });
    expect(s).toContain("a");
    expect(s).toContain("b");
  });
});
