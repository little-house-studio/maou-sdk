import { describe, expect, it } from "vitest";
import {
  formatSenderEnvelope,
  isAgentSenderEnvelope,
  isSenderEnvelope,
  unwrapSenderEnvelope,
} from "./agent-message.js";

describe("formatSenderEnvelope", () => {
  it("wraps from=", () => {
    expect(formatSenderEnvelope({ body: "这边查完了。", from: "help" })).toBe(
      `<message from="help">这边查完了。</message>`,
    );
  });

  it("wraps webhook name=", () => {
    expect(formatSenderEnvelope({ body: "人回来了", name: "门磁" })).toBe(
      `<message name="门磁">人回来了</message>`,
    );
  });

  it("adds reply attrs", () => {
    expect(
      formatSenderEnvelope({
        body: "好",
        from: "help",
        type: "reply",
        inReplyTo: "abc12345",
        to: "coding",
      }),
    ).toBe(`<message from="help" to="coding" type="reply" in_reply_to="abc12345">好</message>`);
  });

  it("omits type=message", () => {
    expect(formatSenderEnvelope({ body: "hi", from: "a", type: "message" })).toBe(
      `<message from="a">hi</message>`,
    );
  });

  it("returns body when no sender", () => {
    expect(formatSenderEnvelope({ body: "裸正文" })).toBe("裸正文");
  });

  it("does not double-wrap", () => {
    const once = formatSenderEnvelope({ body: "ok", from: "help" });
    expect(formatSenderEnvelope({ body: once, from: "other" })).toBe(once);
  });

  it("escapes attributes", () => {
    expect(formatSenderEnvelope({ body: "x", from: `a&b"c<d>` })).toBe(
      `<message from="a&amp;b&quot;c&lt;d&gt;">x</message>`,
    );
  });

  it("unwraps and classifies", () => {
    const agent = `<message from="reviewer">查完了</message>`;
    const webhook = `<message name="门磁">人回来了</message>`;
    expect(isSenderEnvelope(agent)).toBe(true);
    expect(isSenderEnvelope(webhook)).toBe(true);
    expect(isAgentSenderEnvelope(agent)).toBe(true);
    expect(isAgentSenderEnvelope(webhook)).toBe(false);
    expect(unwrapSenderEnvelope(agent)).toBe("查完了");
    expect(unwrapSenderEnvelope("plain")).toBe("plain");
  });
});
