import { describe, it, expect } from "vitest";
import {
  emergencyTrimMessages,
  estimateMessagesTokens,
  stripNonTextContent,
} from "./emergency-trim.js";

describe("emergencyTrimMessages", () => {
  it("under budget → no-op", () => {
    const msgs = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const r = emergencyTrimMessages(msgs, 100_000);
    expect(r.trimmed).toBe(false);
    expect(r.dropped).toBe(0);
    expect(r.messages).toHaveLength(3);
  });

  it("drops middle history, keeps system head + tail", () => {
    const msgs: Array<Record<string, unknown>> = [
      { role: "system", content: "SYSTEM PROMPT " + "x".repeat(200) },
    ];
    for (let i = 0; i < 40; i++) {
      msgs.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn-${i} ` + "y".repeat(800),
      });
    }
    const before = estimateMessagesTokens(msgs);
    const r = emergencyTrimMessages(msgs, Math.floor(before * 0.25), { keepTail: 6 });
    expect(r.trimmed).toBe(true);
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.messages[0]?.role).toBe("system");
    expect(r.estimatedTokens).toBeLessThan(before);
    // tail 仍在
    const joined = r.messages.map((m) => String(m.content ?? "")).join("\n");
    expect(joined).toMatch(/turn-3[0-9]/);
  });
});

describe("stripNonTextContent", () => {
  it("removes image_url parts", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "看这图" },
          { type: "image_url", image_url: { url: "data:image/png;base64,xxx" } },
        ],
      },
    ];
    const r = stripNonTextContent(msgs);
    expect(r.stripped).toBe(1);
    expect(r.messages[0]!.content).toBe("看这图");
  });
});
