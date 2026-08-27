import { describe, expect, it } from "vitest";
import {
  assignTaskIds,
  compressMaou,
  historyVisiblyChanged,
  retainTailBoundary,
} from "./compressor.js";
import { snapRetainStartForToolPairs, toolPairingBalancedAt } from "./tool-pairing.js";
import type { MaouMessage } from "./types/message.js";

function msg(
  seqId: number,
  category: MaouMessage["category"],
  text: string,
  extra?: Partial<MaouMessage>,
): MaouMessage {
  return {
    seqId,
    taskIds: [],
    contents: [{ text }],
    keepAfterCompress: false,
    category,
    ...extra,
  };
}

describe("tool pairing cut", () => {
  it("pulls tool_call into the retained tail when its result is kept", () => {
    const history = [
      msg(0, "user", "go"),
      msg(1, "tool_call", "call", {
        toolCalls: [{ id: "c1", name: "reader", arguments: {} }],
      }),
      msg(2, "tool_result", "RESULT", { toolCallId: "c1" }),
    ];
    const snapped = snapRetainStartForToolPairs(history, 2);
    expect(snapped).toBe(1);
    expect(toolPairingBalancedAt(history, snapped)).toBe(true);
    expect(toolPairingBalancedAt(history, 2)).toBe(false);
  });

  it("retainTailBoundary does not split a closed tool pair", () => {
    const history = assignTaskIds([
      msg(0, "user", `old ${"x".repeat(2000)}`),
      msg(1, "tool_call", "call", {
        toolCalls: [{ id: "c9", name: "grep", arguments: { q: "a" } }],
      }),
      msg(2, "tool_result", `result ${"y".repeat(80)}`, { toolCallId: "c9" }),
    ]);
    const b = retainTailBoundary(history, 40);
    expect(toolPairingBalancedAt(history, b)).toBe(true);
    const tail = history.slice(b);
    const hasResult = tail.some((m) => m.category === "tool_result");
    const hasCall = tail.some((m) => m.toolCalls?.some((t) => t.id === "c9"));
    if (hasResult) expect(hasCall).toBe(true);
  });
});

describe("compressMaou no-op", () => {
  it("force on two short messages stays activeStage", async () => {
    const history = assignTaskIds([
      msg(0, "user", "hi"),
      msg(1, "assistant", "ok"),
    ]);
    const r = await compressMaou(history, { maxTokens: 65536, force: true });
    expect(r.stage).toBe("activeStage");
    expect(historyVisiblyChanged(history, r.history)).toBe(false);
  });

  it("force micro-prunes an old fat tool result outside the token tail", async () => {
    const history = assignTaskIds([
      msg(0, "user", "read it"),
      msg(1, "tool_call", "call", {
        toolCalls: [{ id: "c1", name: "reader", arguments: {} }],
      }),
      msg(2, "tool_result", `tok_orchid_7741\n${"Z".repeat(9000)}TAIL_MARK`, {
        toolCallId: "c1",
      }),
      msg(3, "assistant", "done"),
      msg(4, "user", "next"),
    ]);
    const r = await compressMaou(history, {
      maxTokens: 8000,
      retainTokens: 80,
      force: true,
    });
    expect(r.stage).toBe("compactStage");
    const visible = r.history
      .map((m) =>
        m.contents
          .map((c) => (c.microCompact?.enabled ? c.microCompact.summary : c.text))
          .join(""),
      )
      .join("\n");
    expect(visible).toContain("next");
    expect(visible).toContain("TAIL_MARK");
    expect(visible).toContain("tok_orchid_7741");
    expect(visible.length).toBeLessThan(history[2]!.contents[0]!.text.length);
    expect(visible).not.toContain("Z".repeat(6000));
  });

  it("force compact prunes old fat tools even when the route window is huge", async () => {
    const dump = `BEGIN\n${"line dump\n".repeat(400)}END_OK tok_orchid_7741`;
    const history = assignTaskIds([
      msg(0, "user", "read the catalog"),
      msg(1, "tool_call", "call", {
        toolCalls: [{ id: "c1", name: "reader", arguments: {} }],
      }),
      msg(2, "tool_result", dump, { toolCallId: "c1" }),
      msg(3, "assistant", "saw the file"),
      msg(4, "user", "LATEST_KEEP"),
    ]);
    const r = await compressMaou(history, { maxTokens: 500_000, force: true });
    expect(r.stage).toBe("compactStage");
    expect(historyVisiblyChanged(history, r.history)).toBe(true);
    const visible = r.history
      .map((m) =>
        m.contents
          .map((c) => (c.microCompact?.enabled ? c.microCompact.summary : c.text))
          .join(""),
      )
      .join("\n");
    expect(visible).toContain("LATEST_KEEP");
    expect(visible).toContain("tok_orchid_7741");
    expect(visible).toContain("END_OK");
  });

  it("auto compact leaves a short history untouched on a huge route window", async () => {
    const dump = `BEGIN\n${"line dump\n".repeat(400)}END_OK`;
    const history = assignTaskIds([
      msg(0, "user", "read the catalog"),
      msg(1, "tool_result", dump, { toolCallId: "c1" }),
      msg(2, "assistant", "saw the file"),
    ]);
    const r = await compressMaou(history, { maxTokens: 500_000 });
    expect(r.stage).toBe("activeStage");
    expect(historyVisiblyChanged(history, r.history)).toBe(false);
  });
});
