import { describe, it, expect, beforeEach } from "vitest";
import {
  cliCommands,
  registerBuiltinCliCommands,
  resetBuiltinCliCommandsForTest,
  dispatchSlash,
  syncRuntimeCommands,
  isLocalCommandId,
  uiSlashCommands,
} from "./index.js";

beforeEach(() => {
  resetBuiltinCliCommandsForTest();
  cliCommands.unregisterBySource("runtime");
  cliCommands.unregisterBySource("skill");
  cliCommands.unregisterBySource("dynamic");
  registerBuiltinCliCommands();
});

describe("CliCommandSpec registry", () => {
  it("every builtin has structure fields", () => {
    for (const c of cliCommands.list({ source: "builtin" })) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.label).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.scope).toBeTruthy();
      expect(c.category).toBeTruthy();
    }
  });

  it("select is alias of model", () => {
    const m = cliCommands.get("model");
    const s = cliCommands.get("select");
    expect(m?.id).toBe("model");
    expect(s?.id).toBe("model");
    expect(m?.aliases).toContain("select");
  });

  it("dynamic register is auto-recognized", () => {
    cliCommands.register({
      id: "dynamic:foo",
      name: "foo-cmd",
      label: "Foo",
      description: "dynamic test",
      scope: "local",
      category: "system",
      source: "dynamic",
      local: { kind: "overlay", overlay: "help" },
    });
    expect(cliCommands.isKnown("foo-cmd")).toBe(true);
    const d = dispatchSlash("/foo-cmd");
    expect(d.type).toBe("local");
    if (d.type === "local") {
      expect(d.action).toEqual({ kind: "overlay", overlay: "help" });
    }
  });

  it("syncRuntimeCommands registers runtime specs", () => {
    syncRuntimeCommands([
      { name: "my-runtime", description: "from agent" },
    ]);
    expect(cliCommands.get("my-runtime")?.source).toBe("runtime");
    expect(cliCommands.get("my-runtime")?.scope).toBe("runtime");
    const d = dispatchSlash("/my-runtime");
    expect(d.type).toBe("runtime");
  });

  it("/select provider model → switch_model", () => {
    const d = dispatchSlash("/select xfyun-glm-coding xopglm51");
    expect(d.type).toBe("local");
    if (d.type === "local") {
      expect(d.action).toEqual({
        kind: "switch_model",
        provider: "xfyun-glm-coding",
        model: "xopglm51",
      });
    }
  });

  it("/select with NUL separator", () => {
    const d = dispatchSlash("/select xfyun-glm-coding\0xopglm51");
    expect(d.type).toBe("local");
    if (d.type === "local" && d.action.kind === "switch_model") {
      expect(d.action.provider).toBe("xfyun-glm-coding");
      expect(d.action.model).toBe("xopglm51");
    }
  });

  it("unknown slash → unknown", () => {
    const d = dispatchSlash("/not-registered-xyz");
    expect(d.type).toBe("unknown");
  });

  it("isLocalCommandId + slash list", () => {
    expect(isLocalCommandId("settings")).toBe(true);
    expect(isLocalCommandId("goal")).toBe(false);
    const vals = uiSlashCommands().map((c) => c.value);
    expect(vals).toContain("/model");
    expect(vals).toContain("/select");
  });
});
