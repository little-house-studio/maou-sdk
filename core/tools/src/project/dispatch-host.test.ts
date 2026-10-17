import { afterEach, describe, expect, it } from "vitest";
import {
  bindProjectDispatchHost,
  resetProjectDispatchHostForTest,
  tryProjectDispatch,
} from "./dispatch-host.js";
import { formatProjectDispatchResult } from "./dispatch-result.js";

afterEach(() => {
  resetProjectDispatchHostForTest();
});

describe("project dispatch host", () => {
  it("returns null when no host is bound", async () => {
    await expect(
      tryProjectDispatch({
        projectPath: "/p",
        projectName: "p",
        task: "do",
        parentSessionId: "ops-1",
      }),
    ).resolves.toBeNull();
  });

  it("forwards to the bound host", async () => {
    bindProjectDispatchHost(async (req) => ({
      sessionId: "coding-1",
      agent: "coding",
      switchId: `project:${req.projectPath}:coding`,
      project: req.projectPath,
      status: "running",
      taskId: "t-1",
    }));
    const receipt = await tryProjectDispatch({
      projectPath: "/repo/app",
      projectName: "app",
      task: "fix lint",
      parentSessionId: "ops-1",
    });
    expect(receipt).toMatchObject({
      sessionId: "coding-1",
      status: "running",
      switchId: "project:/repo/app:coding",
    });
  });
});

describe("formatProjectDispatchResult", () => {
  it("includes sessionId and a short summary", () => {
    const text = formatProjectDispatchResult({
      ok: true,
      projectName: "app",
      projectPath: "/repo/app",
      sessionId: "sess-9",
      output: "lint clean",
    });
    expect(text).toMatch(/后台任务成功/);
    expect(text).toMatch(/sessionId: sess-9/);
    expect(text).toMatch(/project: \/repo\/app/);
    expect(text).toMatch(/lint clean/);
  });

  it("marks failure and falls back when output is empty", () => {
    const text = formatProjectDispatchResult({
      ok: false,
      projectName: "app",
      sessionId: "sess-9",
      error: "boom",
    });
    expect(text).toMatch(/后台任务失败/);
    expect(text).toMatch(/boom/);
    expect(text).not.toMatch(/^project:/m);
  });
});
