import { describe, it, expect } from "vitest";
import { Hooks } from "./hooks.js";

describe("Hooks pre_tool_use block reason", () => {
  it("string return blocks and sets lastBlockReason", () => {
    const hooks = new Hooks();
    hooks.register("pre_tool_use", () => "不要写代码");
    const ok = hooks.preToolUse({ id: "1", name: "write_file", parameters: {} } as never);
    expect(ok).toBe(false);
    expect(hooks.lastBlockReason).toBe("不要写代码");
  });

  it("false return blocks without reason", () => {
    const hooks = new Hooks();
    hooks.register("pre_tool_use", () => false);
    const ok = hooks.preToolUse({ id: "1", name: "x", parameters: {} } as never);
    expect(ok).toBe(false);
    expect(hooks.lastBlockReason).toBeUndefined();
  });

  it("true allows", () => {
    const hooks = new Hooks();
    hooks.register("pre_tool_use", () => true);
    expect(hooks.preToolUse({ id: "1", name: "reader", parameters: {} } as never)).toBe(true);
  });
});
