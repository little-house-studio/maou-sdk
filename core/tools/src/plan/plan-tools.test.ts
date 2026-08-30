import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WriteFileTool } from "../file/write_file/tool.js";
import { SubmitPlanTool } from "./submit_plan/tool.js";
import { bindAskUserHost } from "../ask_user/host.js";
import type { AskUserRequest, AskUserResult } from "../ask_user/host.js";
import type { SessionPlanPort, ToolContext } from "@little-house-studio/types";

function port(over: Partial<SessionPlanPort> = {}): SessionPlanPort {
  let markdown = "";
  return {
    get: () => ({
      id: "p1",
      objective: "Ship",
      status: "planning",
      active: true,
      planReady: Boolean(markdown),
      revision: markdown ? 1 : 0,
      createdAt: 1,
      updatedAt: 1,
    }),
    isActive: () => true,
    writePlan: (text) => {
      if (!text.trim().startsWith("#")) throw new Error("plan markdown must start with a # heading");
      markdown = text;
      return {
        id: "p1",
        objective: "Ship",
        status: "review",
        active: true,
        planReady: true,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      };
    },
    readPlan: () => markdown || undefined,
    planFile: () => "/tmp/sess.plan/plan.md",
    approve: () => ({
      id: "p1",
      objective: "Ship",
      status: "approved",
      active: false,
      planReady: true,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
    ...over,
  };
}

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  const sessionPlan = over.sessionPlan ?? port();
  return {
    sessionId: "s",
    projectRoot: "/",
    promptRoot: "/",
    sandboxRoot: "/",
    sandboxMode: "yolo",
    agentName: "coding",
    agentMode: "plan",
    pluginSettings: {},
    workingDir: "/",
    planFile: sessionPlan.planFile(),
    runtimePorts: { sessionPlan },
    sessionPlan,
    ...over,
  };
}

describe("submit_plan", () => {
  it("rejects heading-less markdown", async () => {
    const tool = new SubmitPlanTool();
    const bad = await tool.execute({ plan: "no heading" }, ctx());
    expect(bad.ok).toBe(false);
  });

  it("records a plan even if /plan was not entered first", async () => {
    const tool = new SubmitPlanTool();
    const inactive = await tool.execute(
      { plan: "# X" },
      ctx({ sessionPlan: port({ isActive: () => false }) }),
    );
    expect(inactive.ok).toBe(true);
  });

  it("records a complete plan", async () => {
    const tool = new SubmitPlanTool();
    const result = await tool.execute({ plan: "# Plan\nsteps" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Plan recorded");
  });
});

describe("submit_plan blocks for review", () => {
  afterEach(() => bindAskUserHost(null));

  function host(
    answer: AskUserResult | (() => Promise<AskUserResult>),
    seen: AskUserRequest[] = [],
  ) {
    bindAskUserHost({
      request: async (payload) => {
        seen.push(payload);
        return typeof answer === "function" ? answer() : answer;
      },
    });
    return seen;
  }

  it("hands the plan body + revision to the host so the card can render it", async () => {
    const seen = host({ kind: "plan_review", decision: "approve" });
    const tool = new SubmitPlanTool();
    await tool.execute({ plan: "# Plan\nsteps" }, ctx());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("plan_review");
    expect(seen[0]!.planMarkdown).toBe("# Plan\nsteps");
    expect(seen[0]!.planRevision).toBe(1);
    expect(seen[0]!.planFile).toBe("/tmp/sess.plan/plan.md");
  });

  it("approve exits plan mode and tells the model to implement", async () => {
    host({ kind: "plan_review", decision: "approve", note: "先做 1、2" });
    let approved = false;
    const plan = port();
    const tool = new SubmitPlanTool();
    const res = await tool.execute(
      { plan: "# Plan\nsteps" },
      ctx({
        sessionPlan: {
          ...plan,
          approve: () => {
            approved = true;
            return plan.approve();
          },
        },
      }),
    );
    expect(res.ok).toBe(true);
    expect(approved).toBe(true);
    expect(res.message).toContain("APPROVED");
    expect(res.message).toContain("先做 1、2");
  });

  it("reject keeps plan mode and asks for a rework", async () => {
    host({ kind: "plan_review", decision: "reject" });
    let approved = false;
    const plan = port();
    const res = await new SubmitPlanTool().execute(
      { plan: "# Plan\nsteps" },
      ctx({
        sessionPlan: {
          ...plan,
          approve: () => {
            approved = true;
            return plan.approve();
          },
        },
      }),
    );
    expect(res.ok).toBe(true);
    expect(approved).toBe(false);
    expect(res.message).toContain("REJECTED");
    expect(res.message).toContain("Do not implement");
  });

  it("chat parks the turn without approving", async () => {
    host({ kind: "plan_review", decision: "chat" });
    const res = await new SubmitPlanTool().execute({ plan: "# Plan\nsteps" }, ctx());
    expect(res.ok).toBe(true);
    expect(res.message).toContain("DISCUSS");
  });

  it("subagents never hijack the user's screen — no ask, old text path", async () => {
    const seen = host({ kind: "plan_review", decision: "approve" });
    const res = await new SubmitPlanTool().execute(
      { plan: "# Plan\nsteps" },
      ctx({ parentSessionId: "root" }),
    );
    expect(seen).toHaveLength(0);
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Plan recorded");
  });

  it("host timeout keeps the saved plan instead of failing the turn", async () => {
    host(async () => {
      throw new Error("ask_user timeout");
    });
    const res = await new SubmitPlanTool().execute({ plan: "# Plan\nsteps" }, ctx());
    expect(res.ok).toBe(true);
    expect(res.message).toContain("ask_user timeout");
    expect(res.message).toContain("Do not implement");
  });
});

describe("plan write gate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("does not restrict product-file writes while /plan is active", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-pgate-"));
    dirs.push(dir);
    const planFile = join(dir, "plan.md");
    const write = new WriteFileTool();
    const product = await write.execute(
      { path: "src/app.ts", content: "ok", force: true },
      ctx({ projectRoot: dir, workingDir: dir, planFile }),
    );
    expect(product.ok).toBe(true);
  });
});
