import { describe, it, expect } from "vitest";
import {
  formatTodoNoticeMessage,
  preprocessTodoSlash,
  buildPlanRequiredNotice,
} from "./todo-notice.js";

describe("todo-notice", () => {
  it("preprocessTodoSlash detects /todo and strips", () => {
    const r = preprocessTodoSlash("/todo 实现登录与注册");
    expect(r.requirePlan).toBe(true);
    expect(r.message).toContain("实现登录");
    expect(r.message).not.toMatch(/\/todo/i);
  });

  it("preprocessTodoSlash mid-message", () => {
    const r = preprocessTodoSlash("请帮我 /todo 重构支付模块");
    expect(r.requirePlan).toBe(true);
    expect(r.message).toMatch(/重构支付/);
  });

  it("preprocessTodoSlash no command", () => {
    const r = preprocessTodoSlash("普通消息");
    expect(r.requirePlan).toBe(false);
    expect(r.message).toBe("普通消息");
  });

  it("formatTodoNoticeMessage wraps system_notice", () => {
    const msg = formatTodoNoticeMessage({
      kind: "todo_nudge",
      planId: "p1",
      laneId: "L",
      nodeId: "1",
      targetSessionId: "s",
      body: "继续干活",
    });
    expect(msg).toContain('<system_notice kind="todo_nudge"');
    expect(msg).toContain('plan_id="p1"');
    expect(msg).toContain("继续干活");
    expect(msg).toContain("</system_notice>");
  });

  it("buildPlanRequiredNotice has todo_manage instructions", () => {
    const n = buildPlanRequiredNotice();
    expect(n.kind).toBe("todo_plan_required");
    expect(n.body).toMatch(/todo_manage/);
    expect(n.body).toMatch(/todo_finish/);
  });
});
