import { describe, it, expect } from "vitest";
import {
  resolveSessionEventKind,
  resolveMessageAuthor,
  formatAuthorLabel,
  isUserBubbleKind,
  isHumanTurnKind,
  defaultWireRole,
  authorHuman,
  authorAgent,
  authorSystem,
  authorTool,
} from "./session-event.js";

describe("session-event kind + author", () => {
  it("explicit kind wins", () => {
    expect(resolveSessionEventKind({ kind: "system_notice", role: "user" })).toBe("system_notice");
  });

  it("source maps to kind", () => {
    expect(resolveSessionEventKind({ role: "user", source: "message_bus" })).toBe("agent_message");
    expect(resolveSessionEventKind({ role: "user", source: "empty_retry" })).toBe("runtime_control");
    expect(resolveSessionEventKind({ role: "user", source: "todo_notice" })).toBe("system_notice");
    expect(resolveSessionEventKind({ role: "tool", source: "terminal-notification" })).toBe(
      "tool_async_notify",
    );
  });

  it("author labels", () => {
    expect(formatAuthorLabel(authorHuman())).toBe("user");
    expect(formatAuthorLabel(authorAgent("coding"))).toBe("agent:coding");
    expect(formatAuthorLabel(authorSystem("todo", "todo"))).toBe("system:todo");
    expect(formatAuthorLabel(authorTool("use_terminal"))).toBe("tool:use_terminal");
  });

  it("resolveMessageAuthor from source", () => {
    expect(resolveMessageAuthor({ role: "user", source: "todo_notice" })).toMatchObject({
      type: "system",
      id: "todo",
    });
    expect(resolveMessageAuthor({ role: "user", source: "message_bus", from: "reviewer" })).toMatchObject({
      type: "agent",
      id: "reviewer",
    });
    expect(
      resolveMessageAuthor({
        role: "tool",
        source: "terminal-notification",
        tool_name: "use_terminal",
      }),
    ).toMatchObject({ type: "tool", id: "use_terminal" });
    expect(resolveMessageAuthor({ role: "user", source: "human", content: "hi" })).toMatchObject({
      type: "human",
    });
  });

  it("explicit author wins", () => {
    const a = resolveMessageAuthor({
      role: "user",
      source: "todo_notice",
      author: { type: "system", id: "custom", displayName: "Custom" },
    });
    expect(a.id).toBe("custom");
    expect(formatAuthorLabel(a)).toBe("system:Custom");
  });

  it("bubble vs human turn", () => {
    expect(isUserBubbleKind("human_user")).toBe(true);
    expect(isUserBubbleKind("system_notice")).toBe(false);
    expect(isHumanTurnKind("human_user")).toBe(true);
    expect(isHumanTurnKind("system_notice")).toBe(false);
  });

  it("wire roles", () => {
    expect(defaultWireRole("tool_async_notify")).toBe("tool");
    expect(defaultWireRole("system_notice")).toBe("user");
    expect(defaultWireRole("assistant_turn")).toBe("assistant");
  });
});
