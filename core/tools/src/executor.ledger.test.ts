import { describe, expect, it } from "vitest";
import { Tool, createToolResponse } from "./base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "./base.js";
import { ToolExecutor } from "./executor.js";
import { ToolRegistry } from "./registry.js";
import type { SessionLedgerEvent, SessionLedgerPort } from "@little-house-studio/types";

class PingTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "ping",
    aliases: [],
    description: "ping",
    parameters: { type: "object", properties: {} },
    allowedModes: null,
  };

  async execute(): Promise<ToolResponse> {
    return createToolResponse(true, "pong");
  }
}

describe("ToolExecutor ledger auto-hook", () => {
  it("records tool/exec for any tool without the tool writing ledger code", async () => {
    const events: SessionLedgerEvent[] = [];
    const port: SessionLedgerPort = {
      append(type, data) {
        events.push({
          seq: events.length + 1,
          type,
          ts: new Date().toISOString(),
          sessionId: "s",
          surface: "log",
          data,
        });
        return { seq: events.length };
      },
      query: () => ({ events, total: events.length, catalog: [] }),
      catalog: () => [],
    };

    const registry = new ToolRegistry();
    registry.register(new PingTool());
    const executor = new ToolExecutor(registry);
    const ctx = {
      sessionId: "s",
      projectRoot: "/",
      promptRoot: "/",
      sandboxRoot: "/",
      sandboxMode: "yolo",
      agentName: "coding",
      agentMode: "execute",
      pluginSettings: {},
      workingDir: "/",
      runtimePorts: { sessionLedger: port },
    } as ToolContext;

    const out = await executor.executeSingle(
      { id: "c1", name: "ping", parameters: {} },
      ctx,
    );
    expect(out.result.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("tool/exec");
    expect(events[0]?.data).toMatchObject({ name: "ping", toolCallId: "c1", ok: true });
  });
});
