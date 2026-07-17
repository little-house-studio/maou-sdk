import { describe, it, expect, beforeEach } from "vitest";
import {
  CLI_COMMANDS,
  isLocalCommandId,
  uiSlashCommands,
  commandPaletteItems,
  helpKeyRows,
  registerBuiltinCliCommands,
  cliCommands,
} from "./cli-commands.js";
import { resetBuiltinCliCommandsForTest } from "../slash/index.js";

beforeEach(() => {
  resetBuiltinCliCommandsForTest();
  registerBuiltinCliCommands();
});

describe("cli-commands registry", () => {
  it("local ids cover settings/new/screenshot", () => {
    expect(isLocalCommandId("settings")).toBe(true);
    expect(isLocalCommandId("new")).toBe(true);
    expect(isLocalCommandId("screenshot")).toBe(true);
    expect(isLocalCommandId("goal")).toBe(false);
  });

  it("slash list has /settings and /new", () => {
    const vals = uiSlashCommands().map((c) => c.value);
    expect(vals).toContain("/settings");
    expect(vals).toContain("/new");
    expect(vals).toContain("/model");
    expect(vals).toContain("/select");
  });

  it("/select is local (system, not LLM)", () => {
    expect(isLocalCommandId("select")).toBe(true);
    expect(isLocalCommandId("model")).toBe(true);
  });

  it("palette has unique ids", () => {
    const items = commandPaletteItems();
    const ids = items.map((i) => i.value);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("settings");
  });

  it("help rows non-empty", () => {
    expect(helpKeyRows().length).toBeGreaterThan(5);
  });

  it("every command has structured config", () => {
    for (const c of CLI_COMMANDS) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.name || c.id).toBeTruthy();
    }
    // 也可从 registry 直接列
    expect(cliCommands.list().length).toBeGreaterThan(5);
  });
});
