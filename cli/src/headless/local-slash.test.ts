import { describe, it, expect, beforeEach } from "vitest";
import {
  parseLocalSlash,
  parseModelArgs,
  splitSlashTokens,
} from "./local-slash.js";
import {
  registerBuiltinCliCommands,
  resetBuiltinCliCommandsForTest,
  cliCommands,
} from "../slash/index.js";

beforeEach(() => {
  resetBuiltinCliCommandsForTest();
  cliCommands.unregisterBySource("runtime");
  cliCommands.unregisterBySource("skill");
  registerBuiltinCliCommands();
});

describe("splitSlashTokens", () => {
  it("splits spaces and NUL (model overlay value)", () => {
    expect(splitSlashTokens("select xfyun-glm-coding\0xopglm51")).toEqual([
      "select",
      "xfyun-glm-coding",
      "xopglm51",
    ]);
  });
});

describe("parseModelArgs", () => {
  it("no args → open_model", () => {
    expect(parseModelArgs([])).toEqual({ type: "open_model" });
  });

  it("provider model", () => {
    expect(parseModelArgs(["xfyun-glm-coding", "xopglm51"])).toEqual({
      type: "switch_model",
      provider: "xfyun-glm-coding",
      model: "xopglm51",
    });
  });

  it("provider/model", () => {
    expect(parseModelArgs(["xfyun-glm-coding/xopglm51"])).toEqual({
      type: "switch_model",
      provider: "xfyun-glm-coding",
      model: "xopglm51",
    });
  });
});

describe("parseLocalSlash (registry-backed)", () => {
  it("plain text → passthrough", () => {
    expect(parseLocalSlash("hello").type).toBe("passthrough");
  });

  it("/select provider model → switch_model", () => {
    expect(parseLocalSlash("/select xfyun-glm-coding xopglm51")).toEqual({
      type: "switch_model",
      provider: "xfyun-glm-coding",
      model: "xopglm51",
    });
  });

  it("/model alone → open_model", () => {
    expect(parseLocalSlash("/model")).toEqual({ type: "open_model" });
  });

  it("/sessions → overlay", () => {
    expect(parseLocalSlash("/sessions")).toEqual({
      type: "overlay",
      overlay: "sessions",
    });
  });

  it("/compact known runtime → passthrough", () => {
    expect(parseLocalSlash("/compact").type).toBe("passthrough");
  });

  it("unknown /foo → unknown", () => {
    const r = parseLocalSlash("/not-a-real-cmd");
    expect(r.type).toBe("unknown");
    if (r.type === "unknown") expect(r.id).toBe("not-a-real-cmd");
  });

  it("/new and /clear", () => {
    expect(parseLocalSlash("/new")).toEqual({
      type: "new_session",
      clear: false,
    });
    expect(parseLocalSlash("/clear")).toEqual({
      type: "new_session",
      clear: true,
    });
  });
});
