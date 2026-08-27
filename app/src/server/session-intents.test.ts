import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSessionToolMeta } from "./session-intents";

describe("session-intents", () => {
  it("reads description from assistant toolCalls and tool_parameters", () => {
    const jsonl = [
      JSON.stringify({
        type: "message",
        role: "assistant",
        toolCalls: [
          {
            id: "c1",
            name: "reader",
            parameters: { description: "查看用户屏幕截图" },
          },
        ],
      }),
      JSON.stringify({
        type: "message",
        role: "tool",
        toolCallId: "c1",
        tool_parameters: { description: "查看用户屏幕截图" },
      }),
      JSON.stringify({
        type: "message",
        role: "tool",
        toolCallId: "c2",
        tool_parameters: { description: "获取屏幕分辨率" },
        elapsed: 2400,
      }),
    ].join("\n");
    const meta = parseSessionToolMeta(jsonl);
    assert.equal(meta.intents.c1, "查看用户屏幕截图");
    assert.equal(meta.intents.c2, "获取屏幕分辨率");
    assert.equal(meta.durations.c2, 2400);
  });
});
