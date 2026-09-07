import { describe, it, expect } from "vitest";
import {
  ensureEntryIds,
  selectBranch,
  filterLlmVisible,
  prefixThrough,
  isLlmVisible,
} from "./session-tree.js";

describe("session-tree", () => {
  it("treats legacy linear messages as one branch", () => {
    const msgs = [{ content: "a" }, { content: "b" }, { content: "c" }];
    const branch = selectBranch(msgs);
    expect(branch.map((m) => m.content)).toEqual(["a", "b", "c"]);
    expect(branch.every((m) => m.id)).toBe(true);
  });

  it("walks parentId from leaf and hides abandoned siblings", () => {
    const msgs = [
      { id: "1", parentId: null, content: "root" },
      { id: "2", parentId: "1", content: "left" },
      { id: "3", parentId: "1", content: "right" },
    ];
    expect(selectBranch(msgs, "2").map((m) => m.id)).toEqual(["1", "2"]);
    expect(selectBranch(msgs, "3").map((m) => m.id)).toEqual(["1", "3"]);
  });

  it("drops ui-only entries from LLM projection", () => {
    const msgs = [
      { id: "1", visibility: "both" as const, content: "user" },
      { id: "2", parentId: "1", visibility: "ui" as const, content: "card" },
      { id: "3", parentId: "2", visibility: "llm" as const, content: "next" },
    ];
    const branch = filterLlmVisible(selectBranch(msgs, "3"));
    expect(branch.map((m) => m.id)).toEqual(["1", "3"]);
    expect(isLlmVisible({ visibility: "ui" })).toBe(false);
  });

  it("prefixThrough cuts at boundary for fork", () => {
    const msgs = ensureEntryIds([
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
    ]);
    expect(prefixThrough(msgs, "b").map((m) => m.id)).toEqual(["a", "b"]);
    expect(prefixThrough(msgs, "missing")).toEqual([]);
  });
});
