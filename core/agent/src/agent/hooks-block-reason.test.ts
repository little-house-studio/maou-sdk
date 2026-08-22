import { describe, it, expect } from "vitest";
import { Hooks } from "./hooks.js";

describe("Hooks pre_tool_use block reason", () => {
  it("string return blocks and sets lastBlockReason", async () => {
    const hooks = new Hooks();
    hooks.register("pre_tool_use", () => "不要写代码");
    const ok = await hooks.preToolUse({ id: "1", name: "write_file", parameters: {} } as never);
    expect(ok).toBe(false);
    expect(hooks.lastBlockReason).toBe("不要写代码");
  });

  it("false return blocks without reason", async () => {
    const hooks = new Hooks();
    hooks.register("pre_tool_use", () => false);
    const ok = await hooks.preToolUse({ id: "1", name: "x", parameters: {} } as never);
    expect(ok).toBe(false);
    expect(hooks.lastBlockReason).toBeUndefined();
  });

  it("true allows", async () => {
    const hooks = new Hooks();
    hooks.register("pre_tool_use", () => true);
    expect(await hooks.preToolUse({ id: "1", name: "reader", parameters: {} } as never)).toBe(true);
  });

  it("register returns disposer that unregisters", async () => {
    const hooks = new Hooks();
    const off = hooks.register("pre_tool_use", () => "blocked");
    expect(await hooks.preToolUse({ id: "1", name: "write_file", parameters: {} } as never)).toBe(false);
    off();
    expect(await hooks.preToolUse({ id: "1", name: "write_file", parameters: {} } as never)).toBe(true);
    expect(hooks.lastBlockReason).toBeUndefined();
  });
});
