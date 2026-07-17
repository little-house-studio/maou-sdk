import { describe, it, expect, beforeEach } from "vitest";
import { listKeyBindings, resolveKeyBinding } from "./keybindings.js";
import { getNavAction } from "./nav-actions.js";
import {
  commandOpensOverlay,
  registerBuiltinCliCommands,
  resetBuiltinCliCommandsForTest,
} from "../slash/index.js";

beforeEach(() => {
  resetBuiltinCliCommandsForTest();
  registerBuiltinCliCommands();
});

describe("keybindings from command specs", () => {
  it("ctrl+m → model command", () => {
    const b = resolveKeyBinding("ctrl+m");
    expect(b?.commandId).toBe("model");
  });

  it("ctrl+k → command palette ui", () => {
    const b = resolveKeyBinding("ctrl+k");
    expect(b?.ui).toBe("command_palette");
  });

  it("list includes command + ui bindings", () => {
    const keys = listKeyBindings().map((k) => k.key);
    expect(keys).toContain("ctrl+m");
    expect(keys).toContain("ctrl+k");
    expect(keys).toContain("ctrl+g");
  });
});

describe("nav-actions + overlay keep-open", () => {
  it("sessions is command action", () => {
    expect(getNavAction("sessions")).toEqual({
      id: "sessions",
      kind: "command",
      value: "sessions",
    });
  });

  it("commandOpensOverlay for model/settings", () => {
    expect(commandOpensOverlay("model")).toBe(true);
    expect(commandOpensOverlay("settings")).toBe(true);
    expect(commandOpensOverlay("screenshot")).toBe(false);
  });
});
