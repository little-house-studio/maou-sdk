import { describe, expect, it } from "vitest";
import { ProjectAgentTool } from "./project/project_agent/tool.js";
import { TerminalTool } from "./terminal/use_terminal/tool.js";
import { toolAllowedInAgentMode } from "./tool-mode.js";

describe("toolAllowedInAgentMode", () => {
  it("plan and execute share the same tools", () => {
    expect(toolAllowedInAgentMode(["execute"], "plan")).toBe(true);
    expect(toolAllowedInAgentMode(["plan"], "execute")).toBe(true);
    expect(toolAllowedInAgentMode(["plan", "execute"], "plan")).toBe(true);
    expect(toolAllowedInAgentMode(null, "plan")).toBe(true);
    expect(toolAllowedInAgentMode(["execute"], "ask")).toBe(false);
  });

  it("use_terminal / project_agent stay available in plan", () => {
    expect(
      toolAllowedInAgentMode(new TerminalTool().definition.allowedModes, "plan"),
    ).toBe(true);
    expect(
      toolAllowedInAgentMode(new ProjectAgentTool().definition.allowedModes, "plan"),
    ).toBe(true);
  });
});
