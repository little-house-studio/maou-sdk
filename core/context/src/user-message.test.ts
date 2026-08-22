import { describe, expect, it } from "vitest";
import {
  agentUserMessageText,
  formatAgentSendRuntimeText,
  formatAgentSendSessionText,
  resolveAgentSendMode,
  toAgentSendMessage,
} from "./user-message.js";

describe("toAgentSendMessage", () => {
  it("wraps a string as send content", () => {
    const m = toAgentSendMessage("人回来了");
    expect(m.content).toBe("人回来了");
    expect(m.name).toBeUndefined();
  });

  it("keeps name / image / command / send_mode", () => {
    const m = toAgentSendMessage({
      name: "门磁",
      content: "人回来了",
      image: [{ mimeType: "image/png", data: "abc" }],
      command: "goal",
      send_mode: "queue",
    });
    expect(m).toMatchObject({
      name: "门磁",
      content: "人回来了",
      command: "goal",
      send_mode: "queue",
      image: [{ mimeType: "image/png", data: "abc" }],
    });
  });

  it("flattens content blocks", () => {
    const m = toAgentSendMessage({
      content: [{ text: "hello" }, "world"],
    });
    expect(m.content).toBe("hello\nworld");
  });

  it("allows command without content", () => {
    const m = toAgentSendMessage({ command: "goal" });
    expect(m.command).toBe("goal");
    expect(m.content).toBe("");
  });

  it("rejects empty content without command", () => {
    expect(() => toAgentSendMessage("  ")).toThrow(/content required/);
    expect(() => toAgentSendMessage({ content: "" })).toThrow(/content required/);
    expect(() => toAgentSendMessage(null)).toThrow(/AgentSendMessage/);
  });

  it("formats session wrap and runtime command", () => {
    const m = toAgentSendMessage({
      name: "门磁",
      content: "人回来了",
      command: "goal",
    });
    expect(formatAgentSendSessionText(m)).toBe(
      `<message name="门磁">人回来了</message>`,
    );
    expect(formatAgentSendRuntimeText(m)).toBe("/goal 人回来了");
  });

  it("resolves send_mode aliases", () => {
    expect(resolveAgentSendMode(toAgentSendMessage({ content: "a", send_mode: "队列" }))).toBe("queue");
    expect(resolveAgentSendMode(toAgentSendMessage({ content: "a", send_mode: "停止并发送" }))).toBe("stop_and_send");
    expect(resolveAgentSendMode(toAgentSendMessage({ content: "a" }), "insert")).toBe("insert");
  });

  it("agentUserMessageText reads content", () => {
    expect(agentUserMessageText({ content: "hi" })).toBe("hi");
  });
});
