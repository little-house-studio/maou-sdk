/**
 * 会话账本 → 轮次 POST 请求 / 返回内容（调试面板数据源）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSessionPayloadDetail,
  parseSessionPayloadIndex,
} from "./session-payloads";

/** 现役账本形：{seq,type,data} */
function ledger(type: string, data: Record<string, unknown>, seq: number) {
  return JSON.stringify({ seq, type, ts: "2026-08-29T00:00:00.000Z", data });
}

const REQ = {
  model: "claude-opus-5",
  messages: [
    { role: "system", content: "you are maou" },
    { role: "user", content: "hi" },
  ],
  tools: [{ name: "read_file" }],
  _url: "https://api.example.com/v1/messages",
  _headers: { "Content-Type": "application/json" },
};

const LEDGER = [
  ledger("user/message", { id: "u1", role: "user", kind: "human_user", content: "hi", createdAt: "2026-08-29T00:00:00.000Z" }, 1),
  ledger(
    "assistant/message",
    {
      id: "a1",
      role: "assistant",
      kind: "assistant_turn",
      round: 1,
      content: "sure",
      raw_response: "sure",
      raw_request: REQ,
      reasoningContent: "let me think",
      finish_reason: "tool_calls",
      toolCalls: [{ id: "tc1", name: "read_file", arguments: { path: "a.ts" } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 600 },
      },
    },
    2,
  ),
  ledger("tool/result", { id: "t1", role: "tool", content: "ok" }, 3),
  ledger(
    "assistant/message",
    {
      id: "a2",
      role: "assistant",
      kind: "assistant_turn",
      round: 2,
      content: "done",
      raw_response: "done",
      raw_request: { ...REQ, model: "claude-opus-5" },
      usage: { prompt_tokens: 1200, completion_tokens: 10 },
    },
    4,
  ),
  ledger("user/message", { id: "u2", role: "user", kind: "human_user", content: "again" }, 5),
].join("\n");

describe("session payload index", () => {
  it("indexes user + assistant turns separately, in disk order", () => {
    const { users, turns } = parseSessionPayloadIndex(LEDGER);
    assert.deepEqual(
      users.map((u) => [u.index, u.id]),
      [
        [0, "u1"],
        [1, "u2"],
      ],
    );
    assert.deepEqual(
      turns.map((t) => [t.index, t.id, t.round]),
      [
        [0, "a1", 1],
        [1, "a2", 2],
      ],
    );
    assert.equal(turns[0]!.hasRequest, true);
    assert.equal(turns[0]!.toolCalls, 1);
    assert.equal(turns[0]!.model, "claude-opus-5");
  });

  it("normalizes cache buckets so the hit rate has a real denominator", () => {
    const { turns } = parseSessionPayloadIndex(LEDGER);
    // OpenAI 口径：cached ⊂ prompt_tokens
    assert.equal(turns[0]!.usage.input, 1000);
    assert.equal(turns[0]!.usage.cacheRead, 600);
    assert.equal(turns[0]!.usage.output, 40);
    assert.equal(turns[0]!.usage.reported, true);
    // 不报 cache 字段的一轮不能伪造成 0%
    assert.equal(turns[1]!.usage.reported, false);
    assert.equal(turns[1]!.usage.cacheRead, 0);
  });

  it("skips non-model turns (system notices / tool results)", () => {
    const noisy = [
      LEDGER,
      ledger("system/notice", { id: "s1", role: "system", content: "x" }, 6),
      ledger("assistant/message", { id: "a3", role: "assistant", kind: "expanded", content: "x" }, 7),
    ].join("\n");
    const { turns } = parseSessionPayloadIndex(noisy);
    assert.deepEqual(turns.map((t) => t.id), ["a1", "a2"]);
  });

  it("reads the legacy flat form (type:message, no data envelope)", () => {
    const legacy = [
      JSON.stringify({ type: "message", role: "user", kind: "human_user", content: "hi" }),
      JSON.stringify({
        type: "message",
        role: "assistant",
        kind: "assistant_turn",
        round: 1,
        raw_response: "ok",
        raw_request: REQ,
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
    ].join("\n");
    const { users, turns } = parseSessionPayloadIndex(legacy);
    assert.equal(users.length, 1);
    assert.equal(turns.length, 1);
    // 老会话没有 entry id —— 只能靠 index 定位
    assert.equal(turns[0]!.id, "");
    assert.equal(turns[0]!.index, 0);
  });

  it("tolerates truncated / non-JSON lines", () => {
    const torn = `${LEDGER}\n{"seq":9,"type":"assistant/mess`;
    const { turns } = parseSessionPayloadIndex(torn);
    assert.equal(turns.length, 2);
  });
});

describe("session payload detail", () => {
  it("splits the POST into url / headers / body and keeps the whole body", () => {
    const d = parseSessionPayloadDetail(LEDGER, "assistant", { id: "a1" });
    assert.ok(d);
    assert.equal(d!.request?.method, "POST");
    assert.equal(d!.request?.url, "https://api.example.com/v1/messages");
    const body = d!.request!.body as Record<string, unknown>;
    assert.equal(body.model, "claude-opus-5");
    assert.equal((body.messages as unknown[]).length, 2);
    assert.equal((body.tools as unknown[]).length, 1);
    // _url / _headers 是我们自己的注解，不属于 body
    assert.ok(!("_url" in body));
    assert.ok(!("_headers" in body));
    assert.ok(d!.request!.bytes > 0);
  });

  it("returns the round's content with tool calls after it", () => {
    const d = parseSessionPayloadDetail(LEDGER, "assistant", { id: "a1" });
    assert.equal(d!.response?.content, "sure");
    assert.equal(d!.response?.reasoning, "let me think");
    assert.equal(d!.response?.finishReason, "tool_calls");
    assert.equal(d!.response?.toolCalls.length, 1);
    assert.equal(d!.response?.toolCalls[0]!.name, "read_file");
  });

  it("locates by index when the entry has no id", () => {
    const legacy = JSON.stringify({
      type: "message",
      role: "assistant",
      kind: "assistant_turn",
      raw_response: "ok",
      raw_request: REQ,
    });
    const d = parseSessionPayloadDetail(legacy, "assistant", { index: 0 });
    assert.equal(d?.response?.content, "ok");
    assert.equal(parseSessionPayloadDetail(legacy, "assistant", { index: 3 }), null);
  });

  it("misses cleanly for an unknown id", () => {
    assert.equal(parseSessionPayloadDetail(LEDGER, "assistant", { id: "nope" }), null);
  });
});
