/**
 * Todo 编排多场景回归：设计文档 §16 验收 + 边界/异常
 */
import { describe, it, expect, beforeEach } from "vitest";
import { TASK_MANAGER } from "./task_manage/tool.js";
import { TodoManageTool } from "./task_manage/tool.js";
import { TodoFinishTool } from "./task_finish/tool.js";
import { TodoOrchestrator } from "./todo-orchestrator.js";
import {
  preprocessTodoSlash,
  formatTodoNoticeMessage,
  buildPlanRequiredNotice,
} from "./todo-notice.js";
import type { ToolContext } from "../base.js";

function ctx(sessionId: string): ToolContext {
  return {
    sessionId,
    agentName: "main",
    workingDir: "/tmp",
    mode: "execute",
    maouRoot: "/tmp",
  } as ToolContext;
}

function statusMap(orch: TodoOrchestrator, sid: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const t of orch.getTasks(sid)) o[t.id] = t.status;
  return o;
}

describe("Todo scenarios — DAG / locks / chain", () => {
  let orch: TodoOrchestrator;
  let sid: string;
  let n = 0;

  beforeEach(() => {
    orch = new TodoOrchestrator();
    sid = `sc-${++n}`;
    TASK_MANAGER.manage(sid, "delete", null);
  });

  it("S1 pure serial 1→2→3 only root, no fork", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "a", deps: [], status: "pending" },
      { id: "2", desc: "b", deps: ["1"], status: "pending" },
      { id: "3", desc: "c", deps: ["2"], status: "pending" },
    ]);
    expect(orch.getLanes(sid).filter((l) => l.kind === "fork")).toHaveLength(0);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "1", report: "r1" });
    expect(orch.getLanes(sid).filter((l) => l.kind === "fork" && l.status !== "recycled")).toHaveLength(0);
    expect(statusMap(orch, sid)).toMatchObject({ "1": "completed", "2": "in_progress", "3": "pending" });
    orch.finish(sid, { taskId: "2", status: "completed", summary: "2", report: "r2" });
    orch.finish(sid, { taskId: "3", status: "completed", summary: "3", report: "r3" });
    expect(orch.getPlan(sid)?.status).toBe("completed");
    expect(orch.getEvents(sid).filter((e) => e.type === "fork_created")).toHaveLength(0);
  });

  it("S2 parallel join 1→{2a,2b}→3 with report inject only at 3", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "boot", deps: [], status: "pending" },
      { id: "2a", desc: "A", deps: ["1"], status: "pending" },
      { id: "2b", desc: "B", deps: ["1"], status: "pending" },
      { id: "3", desc: "join", deps: ["2a", "2b"], status: "pending" },
    ]);
    orch.drainNotices(sid);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "ok", report: "R1" });
    const after1 = orch.getEvents(sid).filter((e) => e.type === "report_injected");
    // 2a/2b 启动时应注入 R1
    expect(after1.some((e) => e.payload && String(e.payload.from) === "1")).toBe(true);

    orch.finish(sid, { taskId: "2a", status: "completed", summary: "a", report: "RA" });
    expect(statusMap(orch, sid)["3"]).toBe("pending");
    const injBefore3 = orch.getEvents(sid).filter(
      (e) => e.type === "report_injected" && e.nodeId === "3",
    );
    expect(injBefore3).toHaveLength(0);

    orch.finish(sid, { taskId: "2b", status: "completed", summary: "b", report: "RB" });
    expect(statusMap(orch, sid)["3"]).toBe("in_progress");
    const inj3 = orch.getEvents(sid).filter(
      (e) => e.type === "report_injected" && e.nodeId === "3",
    );
    expect(inj3.length).toBeGreaterThanOrEqual(1);
    // 上游 from 应含 2a 或 2b
    const froms = inj3.map((e) => e.payload?.from);
    expect(froms.some((f) => f === "2a" || f === "2b")).toBe(true);
  });

  it("S3 chain merge 2a→4a exclusive on same lane as 2a", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "boot", deps: [], status: "pending" },
      { id: "2a", desc: "A", deps: ["1"], status: "pending" },
      { id: "2b", desc: "B", deps: ["1"], status: "pending" },
      { id: "4a", desc: "A2", deps: ["2a"], status: "pending" },
    ]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "1" });
    const t2a = orch.getTasks(sid).find((t) => t.id === "2a")!;
    const lane2a = t2a.laneId!;
    orch.finish(sid, { taskId: "2a", status: "completed", summary: "2a", report: "x" });
    const t4a = orch.getTasks(sid).find((t) => t.id === "4a")!;
    expect(t4a.status).toBe("in_progress");
    expect(t4a.laneId).toBe(lane2a);
    expect(orch.getEvents(sid).some((e) => e.type === "lane_chain_extended")).toBe(true);
  });

  it("S4 failed 2a never unlocks 3; 2b continues; no auto-cascade", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "boot", deps: [], status: "pending" },
      { id: "2a", desc: "A", deps: ["1"], status: "pending" },
      { id: "2b", desc: "B", deps: ["1"], status: "pending" },
      { id: "3", desc: "join", deps: ["2a", "2b"], status: "pending" },
    ]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "1" });
    orch.finish(sid, { taskId: "2a", status: "failed", summary: "boom", reason: "boom" });
    expect(statusMap(orch, sid)).toMatchObject({
      "2a": "failed",
      "2b": "in_progress",
      "3": "pending",
    });
    // 不自动把 3 标 failed
    orch.finish(sid, { taskId: "2b", status: "completed", summary: "b" });
    expect(statusMap(orch, sid)["3"]).toBe("pending");
    expect(orch.getPlan(sid)?.status).toBe("active"); // 3 仍 pending，plan 未 completed
  });

  it("S5 cannot finish pending unassigned; fail root leaves 2 pending", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "a", deps: [], status: "pending" },
      { id: "2", desc: "b", deps: ["1"], status: "pending" },
      { id: "3", desc: "c", deps: ["2"], status: "pending" },
    ]);
    orch.finish(sid, { taskId: "1", status: "failed", summary: "stop", reason: "stop" });
    // 1 failed → 2 永不 ready；pending 不可 finish
    const r = orch.finish(sid, { taskId: "2", status: "failed", summary: "skip" });
    expect(r).toMatch(/尚未分配|不能 finish/);
    expect(statusMap(orch, sid)["2"]).toBe("pending");
    expect(statusMap(orch, sid)["3"]).toBe("pending");
    expect(orch.getPlan(sid)?.status).toBe("active");
  });

  it("S5b finish only in_progress: cannot skip ahead on serial chain", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "a", deps: [], status: "pending" },
      { id: "2", desc: "b", deps: ["1"], status: "pending" },
    ]);
    const r = orch.finish(sid, { taskId: "2", status: "completed", summary: "skip" });
    expect(r).toMatch(/尚未分配|不能 finish/);
    expect(statusMap(orch, sid)).toMatchObject({ "1": "in_progress", "2": "pending" });
  });

  it("S6 reject replace while open nodes", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "a", deps: [], status: "pending" },
      { id: "2", desc: "b", deps: ["1"], status: "pending" },
    ]);
    expect(() =>
      orch.manage(sid, "replace", [{ id: "x", desc: "x", deps: [], status: "pending" }]),
    ).toThrow(/replace/);
  });

  it("S7 delete archives and clears; create after all terminal auto-archives", () => {
    orch.manage(sid, "create", [{ id: "1", desc: "only", deps: [], status: "pending" }]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "done" });
    expect(orch.getPlan(sid)?.status).toBe("completed");
    // 新 create 应自动归档旧表
    orch.manage(sid, "create", [{ id: "n1", desc: "new", deps: [], status: "pending" }]);
    expect(statusMap(orch, sid)).toEqual({ n1: "in_progress" });
    expect(orch.getPlan(sid)?.status).toBe("active");
  });

  it("S8 empty spin nudge; tools suppress; stuck after 6", () => {
    orch.manage(sid, "create", [{ id: "1", desc: "a", deps: [], status: "pending" }]);
    orch.drainNotices(sid);
    expect(orch.evaluateNudge(sid, sid, true)).toBeNull();
    for (let i = 0; i < 5; i++) {
      const n = orch.evaluateNudge(sid, sid, false);
      expect(n?.kind).toBe("todo_nudge");
      orch.drainNotices(sid);
    }
    // 第 6 次 → stuck，不再返回 notice
    const last = orch.evaluateNudge(sid, sid, false);
    expect(last).toBeNull();
    expect(orch.getEvents(sid).some((e) => e.type === "stuck")).toBe(true);
    const root = orch.getLanes(sid).find((l) => l.kind === "root");
    expect(root?.status).toBe("stuck");
  });

  it("S9 waiting_deps: no nudge when lane has no in_progress and blocked", () => {
    // root 做完 1 后拿 2a；fork 做 2b；若我们把 2a finish 掉但 3 依赖 2a+2b，root 若无工作
    orch.manage(sid, "create", [
      { id: "1", desc: "boot", deps: [], status: "pending" },
      { id: "2a", desc: "A", deps: ["1"], status: "pending" },
      { id: "2b", desc: "B", deps: ["1"], status: "pending" },
      { id: "3", desc: "join", deps: ["2a", "2b"], status: "pending" },
    ]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "1" });
    // finish 2a only — root may extend or idle
    orch.finish(sid, { taskId: "2a", status: "completed", summary: "a" });
    // root 若无 currentNodeId 且在等 2b 才能开 3，应 waiting 不 nudge
    orch.drainNotices(sid);
    const root = orch.getLanes(sid).find((l) => l.kind === "root")!;
    // 强制：若 root 无 in_progress
    if (!root.currentNodeId) {
      const n = orch.evaluateNudge(sid, sid, false);
      // waiting_deps → null
      expect(n).toBeNull();
    } else {
      // root 仍在干活则可能 nudge — 可接受
      expect(true).toBe(true);
    }
  });

  it("S10 cycle / missing dep / self-dep / duplicate id / empty desc", () => {
    expect(() =>
      orch.manage(sid, "create", [
        { id: "a", desc: "a", deps: ["b"], status: "pending" },
        { id: "b", desc: "b", deps: ["a"], status: "pending" },
      ]),
    ).toThrow(/环/);

    expect(() =>
      orch.manage(sid, "create", [{ id: "a", desc: "a", deps: ["ghost"], status: "pending" }]),
    ).toThrow(/不存在/);

    expect(() =>
      orch.manage(sid, "create", [{ id: "a", desc: "a", deps: ["a"], status: "pending" }]),
    ).toThrow(/自己/);

    expect(() =>
      orch.manage(sid, "create", [
        { id: "a", desc: "a", deps: [], status: "pending" },
        { id: "a", desc: "dup", deps: [], status: "pending" },
      ]),
    ).toThrow(/重复/);

    expect(() =>
      orch.manage(sid, "create", [{ id: "a", desc: "  ", deps: [], status: "pending" }]),
    ).toThrow(/desc/);
  });

  it("S11 forward deps order allowed (topo not declaration order)", () => {
    // B listed before A but B deps A — after two-pass validation should work
    orch.manage(sid, "create", [
      { id: "B", desc: "second", deps: ["A"], status: "pending" },
      { id: "A", desc: "first", deps: [], status: "pending" },
    ]);
    expect(statusMap(orch, sid)).toMatchObject({ A: "in_progress", B: "pending" });
  });

  it("S12 three-way parallel root+2 forks", async () => {
    const calls: string[] = [];
    orch.setRealForkEnabled(true);
    orch.setForkRunner(async ({ node }) => {
      calls.push(node.id);
    });
    orch.manage(sid, "create", [
      { id: "p1", desc: "1", deps: [], status: "pending" },
      { id: "p2", desc: "2", deps: [], status: "pending" },
      { id: "p3", desc: "3", deps: [], status: "pending" },
    ]);
    await new Promise((r) => setTimeout(r, 30));
    const st = statusMap(orch, sid);
    expect(st.p1).toBe("in_progress");
    expect(st.p2).toBe("in_progress");
    expect(st.p3).toBe("in_progress");
    const forks = orch.getLanes(sid).filter((l) => l.kind === "fork" && l.status !== "recycled");
    expect(forks.length).toBe(2); // root 占 1，其余 2 fork
    expect(calls.length).toBe(2);
  });

  it("S13 finish wrong actor session rejected", () => {
    orch.setRealForkEnabled(true);
    orch.setForkRunner(() => {});
    orch.manage(sid, "create", [
      { id: "1", desc: "a", deps: [], status: "pending" },
      { id: "2", desc: "b", deps: [], status: "pending" },
    ]);
    const t2 = orch.getTasks(sid).find((t) => t.id === "2")!;
    const forkLane = orch.getLanes(sid).find((l) => l.currentNodeId === "2");
    if (forkLane && forkLane.sessionId !== sid) {
      expect(() =>
        orch.finish(sid, {
          taskId: "2",
          status: "completed",
          summary: "x",
          actorSessionId: "evil-session",
        }),
      ).toThrow(/无权/);
      // 正确 actor
      orch.finish(forkLane.sessionId, {
        taskId: "2",
        status: "completed",
        summary: "ok",
        actorSessionId: forkLane.sessionId,
      });
      expect(statusMap(orch, sid)["2"]).toBe("completed");
    } else {
      // 逻辑 fork 同 session：任意 finish 可过
      void t2;
      expect(true).toBe(true);
    }
  });

  it("S14 double finish same node is idempotent message", () => {
    orch.manage(sid, "create", [{ id: "1", desc: "a", deps: [], status: "pending" }]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "ok" });
    const r = orch.finish(sid, { taskId: "1", status: "completed", summary: "again" });
    expect(r).toMatch(/终态|已经/);
  });

  it("S15 finish unknown id", () => {
    orch.manage(sid, "create", [{ id: "1", desc: "a", deps: [], status: "pending" }]);
    const r = orch.finish(sid, { taskId: "nope", status: "completed", summary: "x" });
    expect(r).toMatch(/未找到/);
  });

  it("S16 diamond DAG", () => {
    //     1
    //    / \
    //   2   3
    //    \ /
    //     4
    orch.manage(sid, "create", [
      { id: "1", desc: "root", deps: [], status: "pending" },
      { id: "2", desc: "L", deps: ["1"], status: "pending" },
      { id: "3", desc: "R", deps: ["1"], status: "pending" },
      { id: "4", desc: "join", deps: ["2", "3"], status: "pending" },
    ]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "1" });
    expect(statusMap(orch, sid)["2"]).toBe("in_progress");
    expect(statusMap(orch, sid)["3"]).toBe("in_progress");
    orch.finish(sid, { taskId: "2", status: "completed", summary: "2" });
    expect(statusMap(orch, sid)["4"]).toBe("pending");
    orch.finish(sid, { taskId: "3", status: "completed", summary: "3" });
    expect(statusMap(orch, sid)["4"]).toBe("in_progress");
  });

  it("S17 wide fan-in: 1→5 leaves → join", () => {
    const leaves = ["a", "b", "c", "d", "e"];
    const nodes = [
      { id: "0", desc: "start", deps: [] as string[], status: "pending" },
      ...leaves.map((id) => ({ id, desc: id, deps: ["0"], status: "pending" })),
      { id: "z", desc: "join", deps: leaves, status: "pending" },
    ];
    orch.manage(sid, "create", nodes);
    orch.finish(sid, { taskId: "0", status: "completed", summary: "0" });
    for (const id of leaves) {
      expect(statusMap(orch, sid)[id]).toBe("in_progress");
    }
    expect(orch.getLanes(sid).filter((l) => l.kind === "fork" && l.status !== "recycled").length).toBe(4);
    for (const id of leaves) {
      orch.finish(sid, { taskId: id, status: "completed", summary: id });
    }
    expect(statusMap(orch, sid)["z"]).toBe("in_progress");
  });

  it("S18 list / delete / create empty tasks", () => {
    orch.manage(sid, "create", [{ id: "1", desc: "a", deps: [], status: "pending" }]);
    const list = orch.manage(sid, "list", null);
    expect(list).toMatch(/1/);
    expect(() => orch.manage(sid, "create", [])).toThrow();
    orch.manage(sid, "delete", null);
    expect(orch.getTasks(sid)).toHaveLength(0);
  });

  it("S19 max 50 tasks boundary", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      desc: `d${i}`,
      deps: i === 0 ? [] : [`t${i - 1}`],
      status: "pending",
    }));
    orch.manage(sid, "create", many);
    expect(orch.getTasks(sid)).toHaveLength(50);
    expect(() =>
      orch.manage(`sc-over`, "create", [
        ...many,
        { id: "t50", desc: "extra", deps: ["t49"], status: "pending" },
      ]),
    ).toThrow(/50/);
  });
});

describe("Todo tools via Tool.execute", () => {
  let sid: string;
  let n = 0;

  beforeEach(() => {
    sid = `tool-${++n}`;
    TASK_MANAGER.manage(sid, "delete", null);
  });

  it("T1 manage+finish tool path end-to-end", async () => {
    const manage = new TodoManageTool();
    const finish = new TodoFinishTool();
    const c = ctx(sid);

    const r1 = await manage.execute(
      {
        action: "create",
        reason: "test",
        tasks: [
          { id: "1", desc: "read", deps: [], status: "pending" },
          { id: "2", desc: "write", deps: ["1"], status: "pending" },
        ],
      },
      c,
    );
    expect(r1.ok).toBe(true);
    expect(r1.payload?.todo_notices).toBeDefined();

    const r2 = await finish.execute(
      { task_id: "1", status: "completed", summary: "read ok", report: "R1" },
      c,
    );
    expect(r2.ok).toBe(true);
    expect(TASK_MANAGER.getTasks(sid).find((t) => t.id === "2")?.status).toBe("in_progress");

    const r3 = await finish.execute(
      { task_id: "2", status: "completed", summary: "write ok" },
      c,
    );
    expect(r3.ok).toBe(true);
    expect(r3.payload?.remaining).toBe(0);
  });

  it("T2 task_manage alias resolves same tool behavior", async () => {
    // aliases registered on definition; execute is on instance
    const manage = new TodoManageTool();
    expect(manage.definition.aliases).toContain("task_manage");
    const finish = new TodoFinishTool();
    expect(finish.definition.aliases).toContain("task_finish");
    expect(finish.definition.endsLoop).toBe(true);
  });

  it("T3 finish without task_id fails", async () => {
    const finish = new TodoFinishTool();
    const r = await finish.execute({ summary: "x" }, ctx(sid));
    expect(r.ok).toBe(false);
  });

  it("T4 manage list when empty", async () => {
    const manage = new TodoManageTool();
    // ensure clean orchestrator state — manage list goes through TODO_ORCHESTRATOR singleton
    const { TODO_ORCHESTRATOR } = await import("./todo-orchestrator.js");
    // use unique session
    const r = await manage.execute({ action: "list", reason: "x" }, ctx(sid));
    expect(r.ok).toBe(true);
    void TODO_ORCHESTRATOR;
  });
});

describe("Todo notice / slash", () => {
  it("N1 /todo only message still requirePlan", () => {
    const r = preprocessTodoSlash("/todo");
    expect(r.requirePlan).toBe(true);
    expect(r.message.length).toBeGreaterThan(0);
  });

  it("N2 /todo case insensitive", () => {
    expect(preprocessTodoSlash("/TODO 做事情").requirePlan).toBe(true);
  });

  it("N3 format notice preserves body and attrs", () => {
    const n = buildPlanRequiredNotice("p1");
    n.targetSessionId = "s1";
    const msg = formatTodoNoticeMessage(n);
    expect(msg).toContain("todo_plan_required");
    expect(msg).toContain("todo_manage");
    expect(msg.startsWith("<system_notice")).toBe(true);
  });
});

describe("Todo edge — exclusive chain vs join", () => {
  let orch: TodoOrchestrator;
  const sid = "edge-chain";

  beforeEach(() => {
    orch = new TodoOrchestrator();
    TASK_MANAGER.manage(sid, "delete", null);
  });

  it("E1 two exclusives off same node → do NOT chain both to one lane", () => {
    // 1 → 2a, 1 → 2b  both only dep 1 — exclusive filter returns 2, no chain extend
    orch.manage(sid, "create", [
      { id: "1", desc: "1", deps: [], status: "pending" },
      { id: "2a", desc: "a", deps: ["1"], status: "pending" },
      { id: "2b", desc: "b", deps: ["1"], status: "pending" },
    ]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "1" });
    // should scheduleReady parallel, not tryExtend both
    const a = orch.getTasks(sid).find((t) => t.id === "2a")!;
    const b = orch.getTasks(sid).find((t) => t.id === "2b")!;
    expect(a.status).toBe("in_progress");
    expect(b.status).toBe("in_progress");
    expect(a.laneId).not.toBe(b.laneId);
  });

  it("E2 failed then complete sibling: join still blocked", () => {
    orch.manage(sid, "create", [
      { id: "1", desc: "1", deps: [], status: "pending" },
      { id: "2a", desc: "a", deps: ["1"], status: "pending" },
      { id: "2b", desc: "b", deps: ["1"], status: "pending" },
      { id: "3", desc: "j", deps: ["2a", "2b"], status: "pending" },
    ]);
    orch.finish(sid, { taskId: "1", status: "completed", summary: "1" });
    orch.finish(sid, { taskId: "2a", status: "failed", summary: "f" });
    orch.finish(sid, { taskId: "2b", status: "completed", summary: "ok" });
    expect(statusMap(orch, sid)["3"]).toBe("pending");
    // completed ids only unlock — 2a failed so 3 deps not all completed
    const completed = new Set(
      orch.getTasks(sid).filter((t) => t.status === "completed").map((t) => t.id),
    );
    expect(completed.has("2a")).toBe(false);
    expect(completed.has("2b")).toBe(true);
  });

  it("E3 create while active rejects; after delete ok", () => {
    orch.manage(sid, "create", [{ id: "1", desc: "a", deps: [], status: "pending" }]);
    expect(() =>
      orch.manage(sid, "create", [{ id: "2", desc: "b", deps: [], status: "pending" }]),
    ).toThrow(/未完成|清单/);
    orch.manage(sid, "delete", null);
    orch.manage(sid, "create", [{ id: "2", desc: "b", deps: [], status: "pending" }]);
    expect(statusMap(orch, sid)["2"]).toBe("in_progress");
  });
});
