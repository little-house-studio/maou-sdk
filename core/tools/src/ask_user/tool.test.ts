import { describe, expect, it } from "vitest";
import { AskUserTool } from "./tool.js";
import type { ToolContext } from "../base.js";

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    projectRoot: process.cwd(),
    workingDir: process.cwd(),
    agentMode: "execute",
    agentName: "coding",
    sessionId: "root",
    sandboxMode: "yolo",
    ...over,
  } as ToolContext;
}

describe("ask_user", () => {
  const tool = new AskUserTool();

  it("fails on a child session", async () => {
    const res = await tool.execute(
      { kind: "plan_review", description: "ask" },
      ctx({ sessionId: "child", parentSessionId: "root" }),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("ask_user_not_root");
  });
});
