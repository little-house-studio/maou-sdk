import { describe, expect, it } from "vitest";
import { DEFAULT_INSTALL_AGENT_NAME, INSTALL_TOOL_WHITELIST } from "./defaults.js";

describe("install agent defaults", () => {
  it("keeps a narrow install-only whitelist", () => {
    expect(DEFAULT_INSTALL_AGENT_NAME).toBe("install");
    expect(INSTALL_TOOL_WHITELIST).toContain("use_terminal");
    expect(INSTALL_TOOL_WHITELIST).toContain("search_internet");
    expect(INSTALL_TOOL_WHITELIST).toContain("web_fetch");
    expect(INSTALL_TOOL_WHITELIST).toContain("read_file");
    expect(INSTALL_TOOL_WHITELIST).toContain("write_file");
    expect(INSTALL_TOOL_WHITELIST).toContain("edit_file");
    expect(INSTALL_TOOL_WHITELIST).toContain("glob");
    expect(INSTALL_TOOL_WHITELIST).toContain("grep");
    expect(INSTALL_TOOL_WHITELIST).toContain("todo/*");
    expect(INSTALL_TOOL_WHITELIST).not.toContain("use_browser");
    expect(INSTALL_TOOL_WHITELIST).not.toContain("lsp");
    expect(INSTALL_TOOL_WHITELIST).not.toContain("find_code");
    expect(INSTALL_TOOL_WHITELIST).not.toContain("submit_plan");
    expect(INSTALL_TOOL_WHITELIST).not.toContain("create_goal");
  });
});
