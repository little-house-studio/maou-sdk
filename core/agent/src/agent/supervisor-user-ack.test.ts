import { describe, it, expect, beforeEach } from "vitest";
import {
  SUPERVISOR_MANAGER,
  tryApplySupervisorUserConfirmation,
} from "./supervisor-manager.js";

describe("tryApplySupervisorUserConfirmation", () => {
  beforeEach(() => {
    SUPERVISOR_MANAGER.clear();
  });

  it("confirming_plan + 确认 → started", () => {
    SUPERVISOR_MANAGER.bind({
      mainSessionId: "main-1",
      supervisorSessionId: "sup-1",
      state: "confirming_plan",
      plan: "# plan\n- do stuff",
    });
    // bind always starts planning unless we update
    SUPERVISOR_MANAGER.updateState("main-1", "confirming_plan");
    SUPERVISOR_MANAGER.updatePlan("main-1", "# plan\n- do stuff");

    const r = tryApplySupervisorUserConfirmation("sup-1", "确认");
    expect(r.applied).toBe(true);
    expect(r.state).toBe("started");
    expect(r.ended).toBeUndefined();
    expect(r.continueAsUserMessage).toContain("started");
    expect(SUPERVISOR_MANAGER.getByMain("main-1")?.state).toBe("started");
  });

  it("confirming_plan without plan → not applied", () => {
    SUPERVISOR_MANAGER.bind({
      mainSessionId: "main-2",
      supervisorSessionId: "sup-2",
    });
    SUPERVISOR_MANAGER.updateState("main-2", "confirming_plan");
    const r = tryApplySupervisorUserConfirmation("sup-2", "确认");
    expect(r.applied).toBe(false);
  });

  it("confirming + 通过 → ended and unbind", () => {
    SUPERVISOR_MANAGER.bind({
      mainSessionId: "main-3",
      supervisorSessionId: "sup-3",
      plan: "p",
    });
    SUPERVISOR_MANAGER.updateState("main-3", "confirming");
    const r = tryApplySupervisorUserConfirmation("sup-3", "通过");
    expect(r.applied).toBe(true);
    expect(r.ended).toBe(true);
    expect(r.mainSessionId).toBe("main-3");
    expect(SUPERVISOR_MANAGER.getByMain("main-3")).toBeUndefined();
  });

  it("unrelated text → not applied", () => {
    SUPERVISOR_MANAGER.bind({
      mainSessionId: "main-4",
      supervisorSessionId: "sup-4",
      plan: "p",
    });
    SUPERVISOR_MANAGER.updateState("main-4", "confirming_plan");
    SUPERVISOR_MANAGER.updatePlan("main-4", "p");
    const r = tryApplySupervisorUserConfirmation("sup-4", "把验收标准改严一点");
    expect(r.applied).toBe(false);
    expect(SUPERVISOR_MANAGER.getByMain("main-4")?.state).toBe("confirming_plan");
  });

  it("already started + 确认 → idempotent continue", () => {
    SUPERVISOR_MANAGER.bind({
      mainSessionId: "main-5",
      supervisorSessionId: "sup-5",
      plan: "p",
    });
    SUPERVISOR_MANAGER.updatePlan("main-5", "p");
    SUPERVISOR_MANAGER.updateState("main-5", "started");
    const r = tryApplySupervisorUserConfirmation("sup-5", "确认");
    expect(r.applied).toBe(true);
    expect(r.state).toBe("started");
    expect(r.continueAsUserMessage).toContain("started");
  });
});
