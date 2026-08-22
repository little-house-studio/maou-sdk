import { describe, it, expect, beforeEach } from "vitest";
import {
  registerShortcut,
  resolveShortcut,
  listShortcuts,
  clearShortcuts,
} from "./shortcuts.js";

describe("registerShortcut", () => {
  beforeEach(() => clearShortcuts());

  it("registers and resolves normalized keys", async () => {
    let hit = "";
    registerShortcut("Ctrl+Shift+P", {
      description: "plan",
      handler: (ctx) => {
        hit = ctx.key;
      },
    });
    const sc = resolveShortcut("ctrl+shift+p");
    expect(sc?.description).toBe("plan");
    await sc?.handler({ key: sc.key });
    expect(hit).toBe("ctrl+shift+p");
    expect(listShortcuts()).toHaveLength(1);
  });

  it("disposer removes the binding", () => {
    const off = registerShortcut("ctrl+x", {
      description: "x",
      handler: () => {},
    });
    off();
    expect(resolveShortcut("ctrl+x")).toBeUndefined();
  });
});
