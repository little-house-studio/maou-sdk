import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backfillUserLoopDuration,
  collectToolCallIntents,
  readHistoryToolMeta,
  readLoopDurationMs,
  readRoleDurationMs,
  readToolElapsed,
  readToolIntent,
  slimAssistantToolCalls,
} from "./tool-history";

describe("tool-history", () => {
  it("reads description from params object or JSON string", () => {
    assert.equal(readToolIntent({ description: "读剪贴板" }), "读剪贴板");
    assert.equal(
      readToolIntent(JSON.stringify({ description: "列窗口" })),
      "列窗口",
    );
    assert.equal(
      readToolIntent({ parameters: { description: "nested" } }),
      "nested",
    );
    assert.equal(readToolIntent({ command: "ls" }), "");
  });

  it("pairs assistant toolCalls to a tool result by id", () => {
    const intents = collectToolCallIntents([
      {
        role: "assistant",
        toolCalls: [
          {
            id: "c1",
            arguments: { description: "读前台窗口标题", command: "x" },
          },
        ],
      },
    ]);
    assert.equal(intents.get("c1"), "读前台窗口标题");
    const meta = readHistoryToolMeta(
      { role: "tool", toolCallId: "c1", elapsed: 1130 },
      intents,
    );
    assert.equal(meta.toolDescription, "读前台窗口标题");
    assert.equal(meta.durationMs, 1130);
  });

  it("prefers tool_parameters on the tool row itself", () => {
    const meta = readHistoryToolMeta(
      {
        role: "tool",
        tool_call_id: "c2",
        tool_parameters: { description: "扫路由" },
        durationMs: 42,
      },
      new Map([["c2", "ignored"]]),
    );
    assert.equal(meta.toolDescription, "扫路由");
    assert.equal(readToolElapsed({ elapsed: 0 }), undefined);
    assert.equal(meta.durationMs, 42);
  });

  it("reads OpenAI nested function.arguments and slims assistant calls", () => {
    const m = {
      role: "assistant",
      toolCalls: [
        {
          id: "c3",
          function: {
            arguments: JSON.stringify({ description: "打开 DeepSeek" }),
          },
        },
      ],
    };
    assert.equal(collectToolCallIntents([m]).get("c3"), "打开 DeepSeek");
    assert.deepEqual(slimAssistantToolCalls(m), [
      { id: "c3", description: "打开 DeepSeek" },
    ]);
  });

  it("reads role / loop duration and backfills the user row", () => {
    assert.equal(readRoleDurationMs({ durationMs: 0 }), 0);
    assert.equal(readLoopDurationMs({ loopDurationMs: 1500 }), 1500);
    const lines = [
      { role: "user" as const },
      { role: "assistant" as const, loopDurationMs: 1500 },
    ];
    backfillUserLoopDuration(lines);
    assert.equal(lines[0]!.durationMs, 1500);
  });
});
