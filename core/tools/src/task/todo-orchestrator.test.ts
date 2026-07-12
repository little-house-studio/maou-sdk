import { describe, it, expect, beforeEach } from "vitest";
import { TASK_MANAGER } from "./task_manage/tool.js";
import { TodoOrchestrator } from "./todo-orchestrator.js";

function planParallelJoin() {
  return [
    { id: "1", desc: "bootstrap", deps: [], status: "pending" },
    { id: "2a", desc: "front", deps: ["1"], status: "pending" },
    { id: "2b", desc: "back", deps: ["1"], status: "pending" },
    { id: "3", desc: "join", deps: ["2a", "2b"], status: "pending" },
  ];
}

function planChain() {
  return [
    { id: "1", desc: "a", deps: [], status: "pending" },
    { id: "2", desc: "b", deps: ["1"], status: "pending" },
    { id: "3", desc: "c", deps: ["2"], status: "pending" },
  ];
}

describe("TodoOrchestrator P0", () => {
  let orch: TodoOrchestrator;
  const sid = "sess-test";

  beforeEach(() => {
    orch = new TodoOrchestrator();
    TASK_MANAGER.manage(sid, "delete", null);
  });

  it("create schedules root on first ready", () => {
    orch.manage(sid, "create", planChain());
    const tasks = orch.getTasks(sid);
    expect(tasks.find((t) => t.id === "1")?.status).toBe("in_progress");
    expect(tasks.find((t) => t.id === "2")?.status).toBe("pending");
    const root = orch.getLanes(sid).find((l) => l.kind === "root");
    expect(root?.currentNodeId).toBe("1");
    expect(orch.getEvents(sid).some((e) => e.type === "plan_submitted")).toBe(true);
    expect(orch.getEvents(sid).some((e) => e.type === "node_assigned")).toBe(true);
  });

  it("serial exclusive chain extends same root lane (C)", () => {
    orch.manage(sid, "create", planChain());
    orch.finish(sid, {
      taskId: "1",
      status: "completed",
      summary: "done 1",
      report: "report-1",
    });
    const t2 = orch.getTasks(sid).find((t) => t.id === "2");
    expect(t2?.status).toBe("in_progress");
    const root = orch.getLanes(sid).find((l) => l.kind === "root");
    expect(root?.currentNodeId).toBe("2");
    expect(orch.getEvents(sid).some((e) => e.type === "lane_chain_extended")).toBe(true);
    // report inject on unlock
    expect(orch.getEvents(sid).some((e) => e.type === "report_injected")).toBe(true);
  });

  it("parallel: root takes 1, fork takes others (R3)", () => {
    orch.manage(sid, "create", planParallelJoin());
    orch.finish(sid, { taskId: "1", status: "completed", summary: "ok" });
    const tasks = orch.getTasks(sid);
    const a = tasks.find((t) => t.id === "2a")!;
    const b = tasks.find((t) => t.id === "2b")!;
    expect(a.status).toBe("in_progress");
    expect(b.status).toBe("in_progress");
    const lanes = orch.getLanes(sid).filter((l) => l.status !== "recycled");
    const forks = lanes.filter((l) => l.kind === "fork");
    expect(forks.length).toBeGreaterThanOrEqual(1);
    expect(a.laneId).not.toBe(b.laneId);
  });

  it("failed does not unlock dependents", () => {
    orch.manage(sid, "create", planParallelJoin());
    orch.finish(sid, { taskId: "1", status: "completed", summary: "ok" });
    orch.finish(sid, {
      taskId: "2a",
      status: "failed",
      summary: "boom",
      reason: "boom",
    });
    const t3 = orch.getTasks(sid).find((t) => t.id === "3");
    expect(t3?.status).toBe("pending"); // still locked (needs 2a completed)
    // 2b can still be in progress
    const t2b = orch.getTasks(sid).find((t) => t.id === "2b");
    expect(t2b?.status).toBe("in_progress");
  });

  it("one finish only one node; join waits both", () => {
    orch.manage(sid, "create", planParallelJoin());
    orch.finish(sid, { taskId: "1", status: "completed", summary: "ok" });
    orch.finish(sid, {
      taskId: "2a",
      status: "completed",
      summary: "a",
      report: "ra",
    });
    expect(orch.getTasks(sid).find((t) => t.id === "3")?.status).toBe("pending");
    orch.finish(sid, {
      taskId: "2b",
      status: "completed",
      summary: "b",
      report: "rb",
    });
    expect(orch.getTasks(sid).find((t) => t.id === "3")?.status).toBe("in_progress");
  });

  it("rejects replace while in progress", () => {
    orch.manage(sid, "create", planChain());
    expect(() =>
      orch.manage(sid, "replace", [{ id: "x", desc: "nope", deps: [], status: "pending" }]),
    ).toThrow(/禁止 replace/);
    expect(orch.getEvents(sid).some((e) => e.type === "manage_rejected")).toBe(true);
  });

  it("nudge when in_progress and no tools", () => {
    orch.manage(sid, "create", planChain());
    orch.drainNotices(sid);
    const n = orch.evaluateNudge(sid, sid, false);
    expect(n?.kind).toBe("todo_nudge");
    expect(orch.getEvents(sid).some((e) => e.type === "nudge")).toBe(true);
  });

  it("no nudge when had tool calls", () => {
    orch.manage(sid, "create", planChain());
    orch.drainNotices(sid);
    expect(orch.evaluateNudge(sid, sid, true)).toBeNull();
  });

  it("cycle rejected", () => {
    expect(() =>
      orch.manage(sid, "create", [
        { id: "a", desc: "a", deps: ["b"], status: "pending" },
        { id: "b", desc: "b", deps: ["a"], status: "pending" },
      ]),
    ).toThrow(/环/);
  });

  it("drainNotices returns plan_submitted", () => {
    orch.manage(sid, "create", planChain());
    const notices = orch.drainNotices(sid);
    expect(notices.some((n) => n.kind === "todo_plan_submitted")).toBe(true);
    expect(notices.some((n) => n.kind === "todo_unlock")).toBe(true);
    expect(orch.drainNotices(sid)).toEqual([]);
  });

  it("requeueNotices restores undelivered", () => {
    orch.manage(sid, "create", planChain());
    const all = orch.drainNotices(sid);
    const keep = all.slice(0, 1);
    const rest = all.slice(1);
    orch.requeueNotices(sid, rest);
    const again = orch.drainNotices(sid);
    expect(again.length).toBe(rest.length);
    expect(keep.length).toBe(1);
  });

  it("debugSnapshot exposes plan tasks lanes events", () => {
    orch.manage(sid, "create", planChain());
    const snap = orch.debugSnapshot(sid);
    expect(snap.rootSessionId).toBe(sid);
    expect(snap.plan?.status).toBe("active");
    expect(snap.tasks.length).toBe(3);
    expect(snap.lanes.some((l) => l.kind === "root")).toBe(true);
    expect(snap.events.length).toBeGreaterThan(0);
  });

  it("full serial flow to plan completed", () => {
    orch.manage(sid, "create", planChain());
    for (const id of ["1", "2", "3"]) {
      orch.finish(sid, {
        taskId: id,
        status: "completed",
        summary: `done ${id}`,
        report: `report ${id}`,
      });
    }
    expect(orch.getPlan(sid)?.status).toBe("completed");
    expect(orch.getTasks(sid).every((t) => t.status === "completed")).toBe(true);
    expect(orch.getEvents(sid).some((e) => e.type === "plan_completed")).toBe(true);
  });

  it("resolveRootSession via fork bind", () => {
    orch.manage(sid, "create", planParallelJoin());
    orch.bindForkSession("fork-sess-x", sid);
    expect(orch.resolveRootSession("fork-sess-x")).toBe(sid);
    expect(orch.getTasks("fork-sess-x").length).toBe(4);
  });

  it("fork runner invoked when real fork enabled", async () => {
    const calls: string[] = [];
    orch.setRealForkEnabled(true);
    orch.setForkRunner(async ({ node, lane }) => {
      calls.push(`${lane.laneId}:${node.id}`);
    });
    orch.manage(sid, "create", planParallelJoin());
    orch.finish(sid, { taskId: "1", status: "completed", summary: "ok" });
    // allow microtask
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.includes("2"))).toBe(true);
  });
});
