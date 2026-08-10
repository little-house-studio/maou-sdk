/**
 * runtime-recovery 纯逻辑测试（无 I/O）。
 */
import { describe, it, expect } from "vitest";
import {
  isOutputTruncatedByLength,
  appendTruncationMarker,
  buildLengthContinuationControl,
  toolCallSignature,
  detectRepeatedToolLoop,
  findSameRoundResourceConflicts,
  extractToolResourceKey,
  TRUNCATION_MARKER,
} from "./runtime-recovery.js";

describe("isOutputTruncatedByLength", () => {
  it("maps length / max_tokens / incomplete → true", () => {
    expect(isOutputTruncatedByLength("length")).toBe(true);
    expect(isOutputTruncatedByLength("max_tokens")).toBe(true);
    expect(isOutputTruncatedByLength("MAX_TOKENS")).toBe(true);
    expect(isOutputTruncatedByLength("incomplete")).toBe(true);
  });

  it("maps stop / tool_calls / null → false", () => {
    expect(isOutputTruncatedByLength("stop")).toBe(false);
    expect(isOutputTruncatedByLength("tool_calls")).toBe(false);
    expect(isOutputTruncatedByLength("end_turn")).toBe(false);
    expect(isOutputTruncatedByLength(null)).toBe(false);
    expect(isOutputTruncatedByLength(undefined)).toBe(false);
  });
});

describe("appendTruncationMarker", () => {
  it("appends once", () => {
    const a = appendTruncationMarker("hello");
    expect(a.startsWith("hello")).toBe(true);
    expect(a).toContain("截断");
    const b = appendTruncationMarker(a);
    expect(b).toBe(a);
  });
});

describe("buildLengthContinuationControl", () => {
  it("mentions tools when hasToolCalls", () => {
    const s = buildLengthContinuationControl({ round: 1, hasToolCalls: true });
    expect(s).toContain("<continue>");
    expect(s).toMatch(/工具|tool/i);
  });
  it("asks seamless continue without tools", () => {
    const s = buildLengthContinuationControl({ round: 1, hasToolCalls: false });
    expect(s).toContain("续写");
    expect(s).toContain("max_tokens");
  });
});

describe("toolCallSignature + detectRepeatedToolLoop", () => {
  it("same path edits share signature family", () => {
    const a = toolCallSignature({
      name: "edit_file",
      parameters: { path: "src/a.ts", old_text: "x", new_text: "y" },
    });
    const b = toolCallSignature({
      name: "edit_file",
      parameters: { path: "src/a.ts", old_text: "x", new_text: "y" },
    });
    expect(a).toBe(b);
  });

  it("detects loop when one signature dominates window", () => {
    const sig = toolCallSignature({
      name: "read",
      parameters: { path: "x.ts" },
    });
    const recent = Array.from({ length: 10 }, () => sig);
    const hit = detectRepeatedToolLoop(recent, { window: 10, ratio: 0.7 });
    expect(hit.looping).toBe(true);
    expect(hit.dominant).toBe(sig);
  });

  it("does not flag diverse calls", () => {
    const recent = [
      toolCallSignature({ name: "a", parameters: { path: "1" } }),
      toolCallSignature({ name: "b", parameters: { path: "2" } }),
      toolCallSignature({ name: "c", parameters: { path: "3" } }),
      toolCallSignature({ name: "d", parameters: { path: "4" } }),
    ];
    expect(detectRepeatedToolLoop(recent, { window: 10 }).looping).toBe(false);
  });
});

describe("findSameRoundResourceConflicts", () => {
  it("flags second write to same path", () => {
    const conflicts = findSameRoundResourceConflicts([
      { name: "write_file", parameters: { path: "a.ts", content: "1" } },
      { name: "edit_file", parameters: { path: "a.ts", old_text: "1", new_text: "2" } },
      { name: "reader", parameters: { path: "b.ts" } },
    ]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.index).toBe(1);
    expect(conflicts[0]!.toolName).toBe("edit_file");
    expect(conflicts[0]!.conflictWithIndex).toBe(0);
  });

  it("allows two reads on same path", () => {
    const conflicts = findSameRoundResourceConflicts([
      { name: "reader", parameters: { path: "a.ts" } },
      { name: "reader", parameters: { path: "a.ts" } },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("flags duplicate terminal commands", () => {
    const conflicts = findSameRoundResourceConflicts([
      { name: "use_terminal", parameters: { command: "rm -rf dist" } },
      { name: "use_terminal", parameters: { command: "rm -rf dist" } },
    ]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.index).toBe(1);
  });

  it("extractToolResourceKey normalizes path", () => {
    expect(
      extractToolResourceKey({
        name: "write_file",
        parameters: { path: "src//a.ts/" },
      }),
    ).toMatch(/^write:src\/\/a\.ts$/);
  });
});

describe("TRUNCATION_MARKER constant", () => {
  it("is non-empty", () => {
    expect(TRUNCATION_MARKER.length).toBeGreaterThan(10);
  });
});
