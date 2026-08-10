/**
 * Agent 工具预检门 — 驱动 shipped collectMissingRequiredParams /
 * missingRequiredToolResponse（与 runtime execOneToolCall 预门同源）。
 */
import { describe, it, expect } from "vitest";
import {
  collectMissingRequiredParams,
  missingRequiredToolResponse,
  hookBlockedToolResponse,
  executeThrownToolResponse,
} from "./tool-result-gates.js";

const readerLike = {
  definition: {
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, start_line: { type: "integer" } },
      required: ["path"],
    },
  },
};

describe("collectMissingRequiredParams (runtime pre-gate logic)", () => {
  it("returns missing required keys for empty / blank params", () => {
    expect(collectMissingRequiredParams(readerLike, {})).toEqual(["path"]);
    expect(collectMissingRequiredParams(readerLike, { path: "" })).toEqual([
      "path",
    ]);
    expect(collectMissingRequiredParams(readerLike, { path: null as unknown as string })).toEqual([
      "path",
    ]);
  });

  it("does not treat false/0 as missing", () => {
    const tool = {
      definition: {
        parameters: { required: ["flag", "n"] },
      },
    };
    expect(
      collectMissingRequiredParams(tool, { flag: false, n: 0 }),
    ).toEqual([]);
  });

  it("returns [] when tool unknown or no required", () => {
    expect(collectMissingRequiredParams(undefined, { path: "x" })).toEqual([]);
    expect(
      collectMissingRequiredParams(
        { definition: { parameters: { required: [] } } },
        {},
      ),
    ).toEqual([]);
  });
});

describe("missingRequiredToolResponse (execOneToolCall pre-gate surface)", () => {
  it("ok:false invalid_args missing_params with tool name and list", () => {
    const missing = collectMissingRequiredParams(readerLike, {});
    const res = missingRequiredToolResponse("reader", missing);
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("invalid_args");
    expect(res.error?.code).toBe("missing_params");
    expect(res.error?.details?.toolName).toBe("reader");
    expect(res.error?.details?.missing).toEqual(["path"]);
    expect(res.message).toContain("reader");
    expect(res.message).toContain("path");
  });
});

describe("hookBlockedToolResponse / executeThrownToolResponse", () => {
  it("hook → policy_denied hook_blocked", () => {
    const res = hookBlockedToolResponse("edit_file", "blocked by policy");
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("policy_denied");
    expect(res.error?.code).toBe("hook_blocked");
    expect(res.message).toContain("blocked by policy");
  });

  it("path-guard throw → sandbox_denied", () => {
    const res = executeThrownToolResponse(
      "reader",
      new Error("路径越过了项目根目录: ../etc/passwd"),
    );
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("sandbox_denied");
  });
});
