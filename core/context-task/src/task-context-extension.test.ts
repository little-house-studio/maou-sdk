import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextEngine } from "@little-house-studio/context";
import { HarnessSessionStore } from "@little-house-studio/context-components";
import { createTaskContextExtension, createTaskPlanPersist, restoreTask } from "./create-task-context-extension.js";
import { TaskSessionStore } from "./task-session-store.js";

function longSession(turns = 16): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < turns; i++) {
    out.push({
      role: "user",
      content: `用户轮 ${i} 请处理长任务 ${"x".repeat(400)}`,
      createdAt: new Date(Date.now() + i * 3).toISOString(),
    });
    out.push({
      role: "assistant",
      content: `助手轮 ${i} 已完成检查 ${"y".repeat(600)}`,
      createdAt: new Date(Date.now() + i * 3 + 1).toISOString(),
    });
  }
  out.push({
    role: "user",
    content: "LATEST_KEEP_TAIL",
    createdAt: new Date().toISOString(),
  });
  return out;
}

describe("createTaskContextExtension", () => {
  let root: string;
  const sessionId = "sess-task";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-task-ext-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("folds by task, writes task_session, and links relatedBlockIds", async () => {
    const harness = new HarnessSessionStore({ maouRoot: root });
    const taskStore = new TaskSessionStore(root, "coding");
    taskStore.saveTaskPlan(sessionId, [
      {
        id: "todo-1",
        desc: "未完成",
        deps: [],
        status: "pending",
        summary: "",
        relatedBlockIds: [],
      },
    ]);
    const engine = new ContextEngine({
      sessionId,
      harnessStore: harness,
      extensions: [createTaskContextExtension(taskStore)],
      summarizer: async ({ taskId }) => `摘要-${taskId ?? "linear"}`,
    });
    const session = longSession();
    engine.seedWorkingSet(session);
    const report = await engine.compress(800, {
      knownTokens: 40_000,
      force: true,
      sourceSessionMessages: session,
    });
    expect(["summaryStage", "archiveStage"]).toContain(report.stage);
    expect(report.blockIds.length).toBeGreaterThan(0);

    const texts = engine
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join("\n"))
      .join("\n");
    expect(texts).toContain("LATEST_KEEP_TAIL");
    expect(texts).toMatch(/<task_summary task="t\d+">/);

    const firstBlock = report.blockIds[0]!;
    expect(existsSync(taskStore.taskFilePath(sessionId, firstBlock))).toBe(true);
    const restored = restoreTask(taskStore, sessionId, firstBlock);
    expect(restored).not.toBeNull();
    expect(restored!.messages.length).toBeGreaterThan(0);

    const plan = taskStore.loadTaskPlan(sessionId);
    expect(plan[0]!.relatedBlockIds?.length).toBeGreaterThan(0);
    for (const id of report.blockIds) {
      expect(plan[0]!.relatedBlockIds).toContain(id);
    }
  });

  it("does not write task_session when the engine has no extension", async () => {
    const harness = new HarnessSessionStore({ maouRoot: root });
    const engine = new ContextEngine({
      sessionId,
      harnessStore: harness,
      summarizer: async () => "线性摘要",
    });
    const session = longSession();
    engine.seedWorkingSet(session);
    const report = await engine.compress(800, {
      knownTokens: 40_000,
      force: true,
      sourceSessionMessages: session,
    });
    expect(report.stage).not.toBe("activeStage");
    expect(report.blockIds).toEqual([]);
    const taskDir = join(root, "agents", "coding", "sessions", sessionId, "task_session");
    expect(existsSync(taskDir)).toBe(false);
  });
});

describe("createTaskPlanPersist", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-task-persist-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps system-appended relatedBlockIds when todo rewrite omits them", () => {
    const taskStore = new TaskSessionStore(root, "coding");
    const persist = createTaskPlanPersist(taskStore);
    taskStore.saveTaskPlan("s1", [
      {
        id: "todo-1",
        desc: "旧",
        deps: [],
        status: "pending",
        summary: "",
        relatedBlockIds: ["t0", "t2"],
      },
    ]);
    persist("s1", [
      {
        id: "todo-1",
        desc: "新",
        deps: [],
        status: "in_progress",
        summary: "",
      },
    ]);
    const plan = taskStore.loadTaskPlan("s1");
    expect(plan[0]!.desc).toBe("新");
    expect(plan[0]!.relatedBlockIds).toEqual(["t0", "t2"]);
  });
});
