import { describe, expect, it } from "vitest";
import { parseWebhookRequest, WebhookParseError } from "./parse.js";

describe("parseWebhookRequest", () => {
  it("legacy { agent, message } becomes action send", () => {
    const r = parseWebhookRequest({
      agent: "ops",
      message: "人回来了",
    });
    expect(r.action).toBe("send");
    if (r.action !== "send") return;
    expect(r.agent).toBe("ops");
    expect(r.message).toMatchObject({
      content: "人回来了",
    });
    expect(r.v).toBe(1);
  });

  it("reuses AgentSendMessage as the speak payload", () => {
    const r = parseWebhookRequest({
      action: "send",
      agent: "ops",
      message: {
        name: "门磁",
        content: "人回来了",
        image: [{ mimeType: "image/png", data: "abc" }],
        command: "goal",
        send_mode: "queue",
      },
    });
    expect(r.action).toBe("send");
    if (r.action !== "send") return;
    expect(r.message).toMatchObject({
      name: "门磁",
      content: "人回来了",
      command: "goal",
      send_mode: "queue",
      image: [{ mimeType: "image/png", data: "abc" }],
    });
  });

  it("implicit action when message is an AgentSendMessage object", () => {
    const r = parseWebhookRequest({
      agent: "ops",
      message: { name: "sensor", content: "hi" },
    });
    expect(r.action).toBe("send");
    if (r.action !== "send") return;
    expect(r.message.content).toBe("hi");
    expect(r.message).toMatchObject({ name: "sensor" });
  });

  it("accepts command-only AgentSendMessage", () => {
    const r = parseWebhookRequest({
      action: "send",
      message: { command: "goal" },
    });
    expect(r.action).toBe("send");
    if (r.action !== "send") return;
    expect(r.message).toMatchObject({ command: "goal", content: "" });
  });

  it("rejects empty Agent Message content", () => {
    expect(() =>
      parseWebhookRequest({ action: "send", message: { content: "" } }),
    ).toThrow(/content required/);
    expect(() =>
      parseWebhookRequest({ action: "send", message: "   " }),
    ).toThrow(/content required/);
  });

  it("requires action when no message", () => {
    expect(() => parseWebhookRequest({})).toThrow(WebhookParseError);
  });

  it("rejects unknown action", () => {
    expect(() => parseWebhookRequest({ action: "explode" })).toThrow(
      /unknown action/,
    );
  });

  it("parses management actions", () => {
    expect(parseWebhookRequest({ action: "status", agent: "coding" }).action).toBe(
      "status",
    );
    expect(parseWebhookRequest({ action: "agents.list" }).action).toBe(
      "agents.list",
    );
    const neu = parseWebhookRequest({
      action: "sessions.new",
      agent: "ops",
      title: "回家",
    });
    expect(neu.action).toBe("sessions.new");
    if (neu.action === "sessions.new") expect(neu.title).toBe("回家");
  });

  it("parses model.set and approval.answer", () => {
    const m = parseWebhookRequest({
      action: "model.set",
      provider: "ds-flash",
      model: "deepseek-v4-flash",
    });
    expect(m.action).toBe("model.set");
    const a = parseWebhookRequest({
      action: "approval.answer",
      approvalId: "ta_1",
      choice: "once",
    });
    expect(a.action).toBe("approval.answer");
    if (a.action === "approval.answer") {
      expect(a.approvalId).toBe("ta_1");
      expect(a.choice).toBe("once");
    }
  });

  it("does not treat correlation id as approvalId", () => {
    expect(() =>
      parseWebhookRequest({
        action: "approval.answer",
        id: "corr-1",
        choice: "once",
      }),
    ).toThrow(/approvalId required/);
  });
});
