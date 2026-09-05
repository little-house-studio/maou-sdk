import { describe, expect, it } from "vitest";
import { Tool, createToolResponse, ensureCallDescriptionSchema } from "./base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "./base.js";
import {
  CALL_ELAPSED_PARAM_NAME,
  applyElapsedReport,
  elapsedFooter,
  ensureCallElapsedSchema,
  formatElapsed,
  wantsElapsedReport,
} from "./elapsed.js";
import { ToolExecutor } from "./executor.js";
import { ToolRegistry } from "./registry.js";

class EchoTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "echo",
    aliases: [],
    description: "echo",
    parameters: { type: "object", properties: {} },
    allowedModes: null,
  };

  async execute(params: Record<string, unknown>): Promise<ToolResponse> {
    return createToolResponse(true, String(params.text ?? "ok"));
  }
}

class QuietTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "quiet",
    aliases: [],
    description: "echo",
    parameters: { type: "object", properties: {} },
    allowedModes: null,
    reportElapsed: false,
  };

  async execute(params: Record<string, unknown>): Promise<ToolResponse> {
    return createToolResponse(true, String(params.text ?? "ok"));
  }
}

function ctx(): ToolContext {
  return {
    sessionId: "s",
    projectRoot: "/",
    promptRoot: "/",
    sandboxRoot: "/",
    sandboxMode: "yolo",
    agentName: "coding",
    agentMode: "execute",
    pluginSettings: {},
    workingDir: "/",
  } as ToolContext;
}

describe("elapsed helpers", () => {
  it("formats sub-second as ms and longer as seconds", () => {
    expect(formatElapsed(0)).toBe("0ms");
    expect(formatElapsed(12)).toBe("12ms");
    expect(formatElapsed(1240)).toBe("1.24s");
    expect(formatElapsed(12_400)).toBe("12.4s");
    expect(elapsedFooter(80)).toBe("[elapsed=80ms]");
  });

  it("defaults on; tool or call can turn off", () => {
    expect(wantsElapsedReport()).toBe(true);
    expect(wantsElapsedReport({})).toBe(true);
    expect(wantsElapsedReport({ report_elapsed: true })).toBe(true);
    expect(wantsElapsedReport({ report_elapsed: false })).toBe(false);
    expect(wantsElapsedReport({ report_elapsed: "false" })).toBe(false);
    expect(wantsElapsedReport({}, false)).toBe(false);
    expect(wantsElapsedReport({ report_elapsed: true }, false)).toBe(false);
  });

  it("appends a footer once and writes payload.elapsed_ms", () => {
    const first = applyElapsedReport(createToolResponse(true, "pong"), 40);
    expect(first.message).toBe("pong\n[elapsed=40ms]");
    expect(first.payload.elapsed_ms).toBe(40);
    const again = applyElapsedReport(first, 99);
    expect(again.message).toBe("pong\n[elapsed=40ms]");
    expect(again.payload.elapsed_ms).toBe(99);
  });

  it("injects optional report_elapsed on the call schema", () => {
    const schema = ensureCallElapsedSchema(
      ensureCallDescriptionSchema({
        type: "object",
        name: "echo",
        parameters: { type: "object", properties: {}, required: [] },
      }),
    );
    const props = (schema.parameters as { properties: Record<string, unknown> }).properties;
    const required = (schema.parameters as { required: string[] }).required;
    expect(props[CALL_ELAPSED_PARAM_NAME]).toMatchObject({ type: "boolean", default: true });
    expect(required).not.toContain(CALL_ELAPSED_PARAM_NAME);
    expect(required).toContain("description");
  });
});

describe("ToolExecutor elapsed stamp", () => {
  it("stamps elapsed on by default; call or definition can turn it off", async () => {
    const registry = new ToolRegistry();
    registry.register(new EchoTool());
    registry.register(new QuietTool());
    const executor = new ToolExecutor(registry);

    const on = await executor.executeSingle(
      { id: "c1", name: "echo", parameters: { text: "hi" } },
      ctx(),
    );
    expect(on.result.message).toMatch(/^hi\n\[elapsed=/);
    expect(on.result.payload.elapsed_ms).toEqual(expect.any(Number));

    const off = await executor.executeSingle(
      { id: "c2", name: "echo", parameters: { text: "hi", report_elapsed: false } },
      ctx(),
    );
    expect(off.result.message).toBe("hi");
    expect(off.result.payload.elapsed_ms).toBeUndefined();

    const quiet = await executor.executeSingle(
      { id: "c3", name: "quiet", parameters: { text: "hi" } },
      ctx(),
    );
    expect(quiet.result.message).toBe("hi");
  });

  it("exposes report_elapsed on native schemas", () => {
    const tool = new EchoTool();
    const schema = tool.nativeToolSchemas()[0] as {
      parameters?: { properties?: Record<string, unknown> };
      properties?: Record<string, unknown>;
    };
    const props = schema.parameters?.properties ?? schema.properties ?? {};
    expect(props[CALL_ELAPSED_PARAM_NAME]).toMatchObject({ type: "boolean" });
  });
});
