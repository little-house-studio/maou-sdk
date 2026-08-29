import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildToolStreakControl,
  consecutiveToolStreak,
  detectRepeatedToolLoop,
  formatToolStreakParams,
  shouldNudgeToolStreak,
  strictToolCallSignature,
  toolCallSignature,
  TOOL_STREAK_PARAMS_MAX_CHARS,
} from "./runtime-recovery.js";

const editA = {
  name: "edit_file",
  parameters: { path: "src/a.ts", old_text: "x", new_text: "1" },
};
const editB = {
  name: "edit_file",
  parameters: { path: "src/a.ts", old_text: "x", new_text: "2" },
};

describe("strictToolCallSignature", () => {
  it("separates two different edits to the same file", () => {
    // 宽签名不看 new_text，会把连续编辑同一文件误判成同一次调用
    expect(toolCallSignature(editA)).toBe(toolCallSignature(editB));
    expect(strictToolCallSignature(editA)).not.toBe(strictToolCallSignature(editB));
  });

  it("still matches a genuinely identical call, whatever the key order", () => {
    const reordered = {
      name: "edit_file",
      parameters: { new_text: "1", path: "src/a.ts", old_text: "x" },
    };
    expect(strictToolCallSignature(editA)).toBe(strictToolCallSignature(reordered));
  });

  it("keeps the tool name readable in the signature", () => {
    expect(strictToolCallSignature(editA).startsWith("edit_file#")).toBe(true);
    expect(strictToolCallSignature({ name: "reader" })).not.toBe(
      strictToolCallSignature({ name: "grep" }),
    );
  });

  it("does not turn a streak of distinct edits into a nudge", () => {
    const sigs = ["1", "2", "3"].map((t) =>
      strictToolCallSignature({ name: "edit_file", parameters: { path: "a.ts", new_text: t } }),
    );
    expect(consecutiveToolStreak(sigs).count).toBe(1);
    expect(shouldNudgeToolStreak(consecutiveToolStreak(sigs).count)).toBe(false);
  });

  it("leaves the wide signature to loop detection", () => {
    const wide = Array.from({ length: 10 }, () => toolCallSignature(editA));
    expect(detectRepeatedToolLoop(wide, { window: 10 }).looping).toBe(true);
  });
});

describe("formatToolStreakParams", () => {
  it("shows the params sorted so the model sees exactly which set", () => {
    const out = formatToolStreakParams({ path: "a.ts", command: "ls" });
    expect(out.indexOf("command")).toBeLessThan(out.indexOf("path"));
  });

  it("caps a huge param blob and says it capped", () => {
    const out = formatToolStreakParams({ content: "x".repeat(9000) });
    expect(out.length).toBeLessThan(TOOL_STREAK_PARAMS_MAX_CHARS + 60);
    expect(out).toContain("参数已截断");
  });

  it("says so plainly when there are no params", () => {
    expect(formatToolStreakParams()).toBe("（无参数）");
    expect(formatToolStreakParams({})).toBe("（无参数）");
  });
});

describe("buildToolStreakControl", () => {
  const call = { name: "use_terminal", parameters: { command: "pnpm build" }, signature: "sig123" };

  it("names the tool at the 3rd hit", () => {
    const s = buildToolStreakControl(3, call);
    expect(s).toContain("use_terminal");
    expect(s).toContain("3 次");
  });

  it("spells out the params and forbids the same set at the 5th", () => {
    const s = buildToolStreakControl(5, call);
    expect(s).toContain("use_terminal");
    expect(s).toContain("5 次");
    expect(s).toContain("pnpm build");
    expect(s).toContain("不要再用这组参数调它");
  });

  it("demands an explanation of the previous failures at the 8th", () => {
    const s = buildToolStreakControl(8, call);
    expect(s).toContain("use_terminal");
    expect(s).toContain("pnpm build");
    expect(s).toContain("不要再用这组参数调它");
    expect(s).toMatch(/为什么没有产生/);
  });

  it("still works from a bare signature string", () => {
    const s = buildToolStreakControl(5, "sig456");
    expect(s).toContain("sig456");
    expect(s).toContain("5 次");
  });
});

describe("runtime wiring", () => {
  const src = readFileSync(new URL("./runtime.ts", import.meta.url), "utf-8");

  it("feeds the streak counter the strict signature", () => {
    const i = src.indexOf("consecutiveToolStreak(");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 80)).toContain("recentStrictSignatures");
  });

  it("hands the nudge the actual tool name and params", () => {
    const i = src.indexOf("buildToolStreakControl(");
    const window = src.slice(i, i + 300);
    expect(window).toContain("name:");
    expect(window).toContain("parameters:");
  });

  it("leaves detectRepeatedToolLoop on the wide signature", () => {
    const i = src.indexOf("detectRepeatedToolLoop(");
    expect(src.slice(i, i + 60)).toContain("recentToolSignatures");
  });
});
