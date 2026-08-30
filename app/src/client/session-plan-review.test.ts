/**
 * Run: pnpm exec tsx --test src/client/session-plan-review.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickPlanAsk,
  resolvePlanReview,
  isPlanReviewOpen,
  isPlanWriteTool,
  type SessionPlanSnap,
  type SessionPlanView,
} from "./session-plan-review.ts";

function view(
  markdown = "# 实施计划\n- 一步",
  plan?: SessionPlanSnap | null,
): SessionPlanView {
  return {
    markdown,
    plan:
      plan === null
        ? undefined
        : (plan ?? {
            status: "review",
            active: true,
            revision: 1,
            planReady: true,
          }),
  };
}

describe("isPlanWriteTool", () => {
  it("matches submit_plan and write_file", () => {
    assert.equal(isPlanWriteTool("submit_plan"), true);
    assert.equal(isPlanWriteTool("write_file"), true);
    assert.equal(isPlanWriteTool("glob"), false);
  });
});

describe("isPlanReviewOpen", () => {
  it("opens after submit_plan review with heading markdown", () => {
    assert.equal(isPlanReviewOpen(view()), true);
  });

  it("opens after write_file while plan mode is active", () => {
    assert.equal(
      isPlanReviewOpen(
        view("# 实施计划\n- 一步", {
          status: "planning",
          active: true,
          revision: 0,
          planReady: false,
        }),
      ),
      true,
    );
  });

  it("hides without a heading, after approve, or when dismissed", () => {
    assert.equal(isPlanReviewOpen(view("no heading")), false);
    assert.equal(
      isPlanReviewOpen(
        view("# 实施计划", { status: "approved", active: false, revision: 1 }),
      ),
      false,
    );
    assert.equal(isPlanReviewOpen(view(), 1), false);
    assert.equal(isPlanReviewOpen(null), false);
  });
});

describe("plan review：阻塞态 vs 顾问态", () => {
  const ask = (over: Record<string, unknown> = {}) => ({
    sessionId: "s1",
    kind: "plan_review",
    planMarkdown: "# 来自工具的计划",
    planRevision: 4,
    title: "目标",
    ...over,
  });

  it("只挑当前焦点会话的 plan_review", () => {
    assert.equal(pickPlanAsk([], "s1"), null);
    assert.equal(pickPlanAsk(null, "s1"), null);
    // 别的会话卡住了，不该画到我这张屏上
    assert.equal(pickPlanAsk([ask({ sessionId: "other" })], "s1"), null);
    // questions 类不是计划审阅
    assert.equal(pickPlanAsk([ask({ kind: "questions" })], "s1"), null);
    assert.equal(pickPlanAsk([ask()], "s1")?.sessionId, "s1");
    // 还没拿到 sessionId 时不挑剔
    assert.equal(pickPlanAsk([ask()], null)?.sessionId, "s1");
  });

  it("有人在等 → 阻塞态，正文用工具带上来的那份", () => {
    const st = resolvePlanReview(view("# 落盘的旧版"), ask());
    assert.equal(st.show, true);
    assert.equal(st.blocking, true);
    assert.equal(st.markdown, "# 来自工具的计划");
    assert.equal(st.revision, 4);
    assert.equal(st.objective, "目标");
  });

  it("阻塞态不受「先不跑」和 planLaunching 影响 —— 收起会把工具永远悬住", () => {
    const st = resolvePlanReview(view(), ask(), {
      dismissedRevision: 4,
      planLaunching: true,
    });
    assert.equal(st.show, true);
    assert.equal(st.blocking, true);
  });

  it("工具没带正文时回落到落盘的那份", () => {
    const st = resolvePlanReview(
      view("# 落盘的计划"),
      ask({ planMarkdown: undefined, planRevision: undefined }),
    );
    assert.equal(st.markdown, "# 落盘的计划");
  });

  it("没人等 → 顾问态，行为与从前一致", () => {
    const st = resolvePlanReview(view("# 计划"), null);
    assert.equal(st.blocking, false);
    assert.equal(st.show, isPlanReviewOpen(view("# 计划"), null));
    // 正在启动仍然生效
    assert.equal(
      resolvePlanReview(view("# 计划"), null, { planLaunching: true }).show,
      false,
    );
  });

  it("落盘已批准 → 收成同意灰卡", () => {
    const st = resolvePlanReview(
      view("# 计划", { status: "approved", active: false, revision: 2 }),
      null,
    );
    assert.equal(st.show, true);
    assert.equal(st.blocking, false);
    assert.equal(st.settled, "approve");
  });

  it("本地已选 → 按 outcome 收纳，不再当顾问卡", () => {
    const st = resolvePlanReview(view("# 计划"), null, {
      settled: { revision: 1, outcome: "reject", note: "改目标" },
    });
    assert.equal(st.show, true);
    assert.equal(st.settled, "reject");
    assert.equal(st.note, "改目标");
    assert.equal(st.blocking, false);
  });

  it("先不跑 → 收成 hold 灰卡，不消失", () => {
    const st = resolvePlanReview(view("# 计划"), null, {
      dismissedRevision: 1,
    });
    assert.equal(st.show, true);
    assert.equal(st.settled, "hold");
  });
});

