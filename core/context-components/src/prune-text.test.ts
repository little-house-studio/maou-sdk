import { describe, expect, it } from "vitest";
import {
  pruneTextHeadTail,
  pruneToolResultText,
  TOOL_RESULT_PRUNE_MARKER,
  TOOL_RESULT_PRUNE_THRESHOLD_CHARS,
} from "./prune-text.js";

describe("pruneTextHeadTail", () => {
  it("keeps head and tail and is strictly shorter", () => {
    const text = `${"HEAD".repeat(20)}${"MID".repeat(80)}${"TAIL".repeat(20)}`;
    const out = pruneTextHeadTail(text, 16, 16);
    expect(out).toBeTruthy();
    expect(out!.startsWith("HEADHEADHEADHEAD")).toBe(true);
    expect(out!.endsWith("TAILTAILTAILTAIL")).toBe(true);
    expect(out!).toContain(TOOL_RESULT_PRUNE_MARKER.trim());
    expect([...out!].length).toBeLessThan([...text].length);
  });

  it("returns null when pruning would not shrink", () => {
    expect(pruneTextHeadTail("short", 100, 100)).toBeNull();
  });
});

describe("pruneToolResultText", () => {
  it("keeps a secret in the tail of a large result", () => {
    const secret = "tok_orchid_7741";
    const text = `${"x".repeat(TOOL_RESULT_PRUNE_THRESHOLD_CHARS + 200)}${secret}`;
    const out = pruneToolResultText(text);
    expect(out).toBeTruthy();
    expect(out!).toContain(secret);
    expect(out!).toContain("[... tool result middle pruned ...]");
  });

  it("prunes medium tool dumps but keeps both ends", () => {
    const text = `BEGIN_PATH=/tmp/a.ts\n${"dump\n".repeat(40)}END_OK`;
    const out = pruneToolResultText(text);
    expect(out).toBeTruthy();
    expect(out!).toContain("BEGIN_PATH");
    expect(out!).toContain("END_OK");
  });
});
