import { describe, expect, it } from "vitest";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import {
  SUPERVISOR_HARNESS_TOOL_NAMES,
  registerSupervisorHarnessTools,
} from "./register.js";

describe("supervisor harness tools", () => {
  it("are not business builtins", () => {
    const reg = new ToolRegistry();
    registerBuiltins(reg);
    const names = new Set(reg.list().map((item) => item.name));
    for (const name of SUPERVISOR_HARNESS_TOOL_NAMES) {
      expect(names.has(name)).toBe(false);
    }
    expect(names.has("supervisor_start")).toBe(false);
  });

  it("register only via harness helper", () => {
    const reg = new ToolRegistry();
    registerSupervisorHarnessTools(reg);
    expect(reg.get("supervisor_task_control")?.definition.name).toBe("supervisor_task_control");
    expect(reg.get("supervisor_chat_main")?.definition.name).toBe("supervisor_chat_main");
  });
});
