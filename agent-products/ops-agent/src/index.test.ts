import { describe, expect, it } from "vitest";
import { DEFAULT_OPS_AGENT_NAME, OPS_TOOL_WHITELIST } from "./defaults.js";

describe("ops agent defaults", () => {
  it("exposes Ops tools without fixed-workspace coding tools", () => {
    expect(DEFAULT_OPS_AGENT_NAME).toBe("ops");
    expect(OPS_TOOL_WHITELIST).toContain("project_agent");
    expect(OPS_TOOL_WHITELIST).toContain("change_self");
    expect(OPS_TOOL_WHITELIST).toContain("use_browser");
    expect(OPS_TOOL_WHITELIST).not.toContain("lsp");
    expect(OPS_TOOL_WHITELIST).not.toContain("find_code");
  });
});
