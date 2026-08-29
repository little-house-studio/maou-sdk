/**
 * 轮次调试面板骨架（closed / loading / error / request / response）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PayloadInspector } from "./PayloadInspector";
import type { PayloadDetail } from "./session-payloads";

const base: PayloadDetail = {
  kind: "assistant",
  index: 0,
  id: "a1",
  round: 1,
  model: "claude-opus-5",
  usage: {
    input: 12_000,
    output: 240,
    cacheRead: 9000,
    cacheWrite: 0,
    reported: true,
  },
  toolCalls: 1,
  hasRequest: true,
  hasResponse: true,
  request: {
    url: "https://api.example.com/v1/messages",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      model: "claude-opus-5",
      messages: [
        { role: "system", content: "you are maou" },
        { role: "user", content: "帮我改一下" },
      ],
      tools: [{ name: "read_file" }],
    },
    bytes: 4096,
  },
  response: {
    content: "好的",
    reasoning: "先看文件",
    finishReason: "tool_calls",
    toolCalls: [{ id: "tc1", name: "read_file", arguments: { path: "a.ts" } }],
    bytes: 512,
  },
};

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    createElement(PayloadInspector, {
      open: true,
      onClose: () => {},
      view: "request",
      title: "#3 提问",
      detail: base,
      ...props,
    } as never),
  );

describe("PayloadInspector", () => {
  it("renders nothing while closed", () => {
    assert.equal(render({ open: false }), "");
  });

  it("request view: endpoint / sizes / cache + the messages array", () => {
    const html = render({ view: "request" });
    assert.match(html, /#3 提问/);
    assert.match(html, /POST 请求/);
    assert.match(html, /https:\/\/api\.example\.com\/v1\/messages/);
    assert.match(html, /4\.0 KB/);
    assert.match(html, /75% · 9\.0k/);
    // 消息按 role 分行，默认展开最后一条
    assert.match(html, /data-role="system"/);
    assert.match(html, /data-role="user"/);
    assert.match(html, /帮我改一下/);
    assert.match(html, /原始 JSON/);
  });

  it("response view: content, reasoning and the tool calls after it", () => {
    const html = render({ view: "response", title: "第 2 轮" });
    assert.match(html, /第 2 轮/);
    assert.match(html, /返回内容/);
    assert.match(html, /tool_calls/);
    assert.match(html, /先看文件/);
    assert.match(html, /read_file/);
    assert.match(html, /a\.ts/);
  });

  it("shows a real cause instead of a blank panel", () => {
    assert.match(render({ loading: true }), /读取账本中/);
    assert.match(render({ error: "boom", loading: false }), /boom/);
    assert.match(render({ detail: null }), /没有找到这一轮的记录/);
    assert.match(
      render({ detail: { ...base, request: null } }),
      /没有 raw_request/,
    );
    assert.match(
      render({ view: "response", detail: { ...base, response: null } }),
      /还没有落盘的返回内容/,
    );
  });

  it("never renders an auth header — the ledger strips them upstream", () => {
    const html = render({ view: "request" });
    assert.doesNotMatch(html, /[Aa]uthorization/);
    assert.doesNotMatch(html, /x-api-key/i);
  });
});
