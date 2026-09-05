import { afterEach, describe, expect, it } from "vitest";
import {
  resetHelperPathCache,
  resetSnapshotsForTest,
  setHelperRunnerForTest,
} from "@little-house-studio/computer-use-engine";
import type { ToolContext } from "../../base.js";
import { ComputerTool } from "./tool.js";

afterEach(() => {
  setHelperRunnerForTest(undefined);
  resetSnapshotsForTest();
  resetHelperPathCache();
  delete process.env.MAOU_COMPUTER_USE_HELPER;
});

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    projectRoot: process.cwd(),
    workingDir: process.cwd(),
    agentMode: "execute",
    agentName: "coding",
    sessionId: "cu-test",
    sandboxMode: "yolo",
    ...over,
  } as ToolContext;
}

describe("use_computer", () => {
  const tool = new ComputerTool();

  it("registers as use_computer and stays visible in plan", () => {
    expect(tool.definition.name).toBe("use_computer");
    expect(tool.definition.allowedModes).toEqual(["plan", "execute"]);
  });

  it("blocks activate in plan", async () => {
    const r = await tool.execute(
      { action: "activate", app: "访达", reason: "x", description: "activate" },
      ctx({ agentMode: "plan" }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/execute/);
  });

  it("blocks click in plan", async () => {
    const r = await tool.execute(
      { action: "click", target: "[1]", reason: "x", description: "click" },
      ctx({ agentMode: "plan" }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/execute/);
  });

  it("allows snapshot in plan via injected helper", async () => {
    process.env.MAOU_COMPUTER_USE_HELPER = "/dev/null";
    resetHelperPathCache();
    setHelperRunnerForTest(async () => ({
      ok: true,
      op: "snapshot",
      route: "ax",
      snapshotId: "cu1_tooltest",
      app: "Finder",
      elements: [{ ref: 1, role: "AXButton", title: "OK", enabled: true }],
      permissions: { ax: true, screen: true, input: true },
    }));
    const r = await tool.execute(
      { action: "snapshot", app: "Finder", reason: "look", description: "snap" },
      ctx({ agentMode: "plan" }),
    );
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/\[1\] AXButton/);
    expect(r.payload.snapshotId).toBe("cu1_tooltest");
  });

  it("help does not need the native helper", async () => {
    const r = await tool.execute({ action: "help", reason: "doc", description: "help" }, ctx());
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/use_browser/);
  });
});
