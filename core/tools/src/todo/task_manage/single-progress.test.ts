import { describe, expect, it } from "vitest";
import { enforceSingleInProgress, TaskManager, type Task } from "./tool.js";

describe("enforceSingleInProgress", () => {
  it("keeps first in_progress and demotes extras", () => {
    const tasks: Task[] = [
      { id: "1", desc: "a", deps: [], status: "in_progress", summary: "" },
      { id: "2", desc: "b", deps: [], status: "in_progress", summary: "" },
      { id: "3", desc: "c", deps: [], status: "pending", summary: "" },
    ];
    enforceSingleInProgress(tasks);
    expect(tasks.map((t) => t.status)).toEqual(["in_progress", "pending", "pending"]);
  });

  it("manage replace demotes extra in_progress", () => {
    const mgr = new TaskManager();
    const out = mgr.manage("s", "replace", [
      { id: "1", desc: "a", deps: [], status: "in_progress" },
      { id: "2", desc: "b", deps: [], status: "in_progress" },
    ]);
    expect(out).not.toMatch(/并行/);
    const tasks = mgr.getTasks("s");
    expect(tasks.filter((t) => t.status === "in_progress")).toHaveLength(1);
  });
});
