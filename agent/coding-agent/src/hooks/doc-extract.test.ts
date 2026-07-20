import { describe, it, expect } from "vitest";
import { Hooks } from "@little-house-studio/agent";
import {
  shouldBlockDocExtractTool,
  registerDocExtractHooks,
  isDocExtractEnabled,
} from "./doc-extract.js";

describe("doc-extract hooks", () => {
  it("blocks write/edit tools by name", () => {
    expect(shouldBlockDocExtractTool("write_file")).toBe(true);
    expect(shouldBlockDocExtractTool("edit_file")).toBe(true);
    expect(shouldBlockDocExtractTool("reader")).toBe(false);
    expect(shouldBlockDocExtractTool("grep")).toBe(false);
  });

  it("pre_tool_use returns reason string and sets lastBlockReason", () => {
    const hooks = new Hooks();
    registerDocExtractHooks(hooks);
    const ok = hooks.preToolUse({
      id: "1",
      name: "write_file",
      parameters: { path: "x.py" },
    } as never);
    expect(ok).toBe(false);
    expect(hooks.lastBlockReason).toMatch(/doc_extract/);
    expect(hooks.lastBlockReason).toMatch(/write_file/);
  });

  it("allows reader", () => {
    const hooks = new Hooks();
    registerDocExtractHooks(hooks);
    const ok = hooks.preToolUse({
      id: "1",
      name: "reader",
      parameters: { path: "a.md" },
    } as never);
    expect(ok).toBe(true);
    expect(hooks.lastBlockReason).toBeUndefined();
  });

  it("isDocExtractEnabled respects explicit option over env", () => {
    expect(isDocExtractEnabled({ docExtractMode: true })).toBe(true);
    expect(isDocExtractEnabled({ docExtractMode: false })).toBe(false);
  });
});
