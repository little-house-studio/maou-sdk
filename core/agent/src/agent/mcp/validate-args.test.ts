import { describe, it, expect } from "vitest";
import {
  validateMcpToolArgs,
  formatMcpArgValidationError,
  rejectIfMcpArgsInvalid,
} from "./validate-args.js";
import { createMcpBridgeTool } from "./tool-bridge.js";

describe("validateMcpToolArgs", () => {
  const schema = {
    type: "object",
    properties: {
      text: { type: "string" },
      n: { type: "integer" },
      mode: { type: "string", enum: ["a", "b"] },
    },
    required: ["text"],
    additionalProperties: false,
  };

  it("accepts valid args", () => {
    const r = validateMcpToolArgs(schema, { text: "hi", n: 1, mode: "a" });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("rejects missing required", () => {
    const r = validateMcpToolArgs(schema, { n: 1 });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "text" && /required/.test(i.message))).toBe(true);
  });

  it("rejects wrong type", () => {
    const r = validateMcpToolArgs(schema, { text: 123 });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "text" && /string/.test(i.message))).toBe(true);
  });

  it("rejects bad enum", () => {
    const r = validateMcpToolArgs(schema, { text: "x", mode: "c" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "mode")).toBe(true);
  });

  it("rejects additionalProperties:false extras", () => {
    const r = validateMcpToolArgs(schema, { text: "x", extra: 1 });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.path === "extra")).toBe(true);
  });

  it("passes empty schema", () => {
    expect(validateMcpToolArgs({}, { anything: true }).ok).toBe(true);
  });
});

describe("formatMcpArgValidationError", () => {
  it("includes schema and issues for model retry", () => {
    const resp = formatMcpArgValidationError({
      toolLabel: "mcp__echo__echo",
      connectionName: "echo",
      originalName: "echo",
      schema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      args: {},
      issues: [{ path: "text", message: "required property missing" }],
      viaGateway: true,
    });
    expect(resp.ok).toBe(false);
    expect(resp.message).toContain("validation failed");
    expect(resp.message).toContain("required property missing");
    expect(resp.message).toContain("inputSchema");
    expect(resp.message).toMatch(/action=list|re-fetch schema/);
    expect(resp.payload?.mcpValidationError).toBe(true);
  });
});

describe("createMcpBridgeTool validates before call", () => {
  it("does not call handler when args invalid", async () => {
    let called = false;
    const tool = createMcpBridgeTool(
      {
        name: "mcp__s__t",
        description: "t",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        connectionName: "s",
        originalName: "t",
      },
      async () => {
        called = true;
        return "should-not-run";
      },
    );
    const resp = await tool.execute({ wrong: 1 }, {
      sessionId: "s",
      agentName: "a",
      projectRoot: process.cwd(),
      maouRoot: process.cwd(),
    } as never);
    expect(called).toBe(false);
    expect(resp.ok).toBe(false);
    expect(resp.message).toContain("validation failed");
    expect(resp.message).toContain("text");
  });

  it("calls handler when args valid", async () => {
    let called = false;
    const tool = createMcpBridgeTool(
      {
        name: "mcp__s__t",
        description: "t",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        connectionName: "s",
        originalName: "t",
      },
      async (_c, _t, args) => {
        called = true;
        return `ok:${args.text}`;
      },
    );
    const resp = await tool.execute({ text: "hi" }, {
      sessionId: "s",
      agentName: "a",
      projectRoot: process.cwd(),
      maouRoot: process.cwd(),
    } as never);
    expect(called).toBe(true);
    expect(resp.ok).toBe(true);
    expect(resp.message).toBe("ok:hi");
  });
});

describe("rejectIfMcpArgsInvalid", () => {
  it("returns null when ok", () => {
    expect(
      rejectIfMcpArgsInvalid({
        toolLabel: "t",
        schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        args: { a: "x" },
      }),
    ).toBeNull();
  });
});
