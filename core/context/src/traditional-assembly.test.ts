import { describe, expect, it } from "vitest";
import { buildMessages, createTraditionalAssembly, TRADITIONAL_SLOT } from "./message-builder.js";

const base = {
  systemPrompt: "sys",
  sessionMessages: [{ role: "user", content: "hi", createdAt: "t" }],
  roundCount: 1,
  currentRound: 1,
};

describe("traditional assembly slots", () => {
  it("buildMessages 仍按默认槽位拼", () => {
    const messages = buildMessages({
      ...base,
      structuredMemory: "mem",
      platformContext: "plat",
    });
    expect(messages.map((m) => m.content)).toEqual(["sys", "plat", "mem", "hi"]);
  });

  it("可以卸掉 memory 槽再拼", () => {
    const assembly = createTraditionalAssembly();
    assembly.remove(TRADITIONAL_SLOT.memory);
    const messages = assembly.assemble({
      ...base,
      structuredMemory: "mem",
      platformContext: "plat",
    });
    expect(messages.map((m) => m.content)).toEqual(["sys", "plat", "hi"]);
  });
});
